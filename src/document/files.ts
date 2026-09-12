import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, fchmodSync, linkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_DOCUMENT_BYTES, validateDraft, type Draft, type DocumentSnapshot } from "../shared/contracts.ts";
import { relocateComment } from "./anchors.ts";
import { isPlainText } from "../shared/document-type.ts";
import { windowsFileKey } from "../platform/windows-channel.ts";

import { hash, parseMetadata, splitMetadata, embedMetadata, type Metadata, type CommentRevision } from "./metadata.ts";
type DiskState = { bytes: Buffer; metadata: Buffer | null; mode: number; signature: string; statKey: string };

// Windows UNC access to WSL does not expose Linux permission bits through stat.
// Keep Linux responsible for private staging and modes; Cottontail still performs
// document parsing, conflict checks, writes and the atomic replacement.
export function wslLocation(path: string): { distro: string; path: string } | null {
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)\\(.*)$/i.exec(path);
  return match ? { distro: match[1]!, path: "/" + match[2]!.replaceAll("\\", "/") } : null;
}
function linuxFileCommand(path: string, command: string, args: string[] = []): string {
  const location = wslLocation(path);
  if (!location) throw new Error("Invalid WSL file path.");
  return execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32/wsl.exe"),
    ["--distribution", location.distro, "--exec", command, ...args, location.path],
    { encoding: "utf8", windowsHide: true, timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const isWSL = (path: string) => process.platform === "win32" && wslLocation(path) !== null;

const metadataPath = (path: string) => `${path}.sideleaf.json`;

/** The existing per-document lock is the only app/CLI ownership handoff arbiter. */
export class DocumentLock {
  readonly lockPath: string;
  private released = false;
  private readonly identity: string;
  constructor(readonly path: string, private readonly fd: number) {
    this.lockPath = `${path}.sideleaf.lock`;
    const stat = fstatSync(fd);
    this.identity = `${stat.dev}:${stat.ino}`;
  }
  assert(path: string) {
    if (this.released || path !== this.path) throw new Error("The document lock does not cover this path.");
  }
  release() {
    if (this.released) return;
    this.released = true;
    closeSync(this.fd);
    try {
      const stat = lstatSync(this.lockPath);
      if (`${stat.dev}:${stat.ino}` === this.identity) unlinkSync(this.lockPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

function tryDocumentLock(path: string): DocumentLock | null {
  const lockPath = `${path}.sideleaf.lock`;
  let fd: number;
  try { fd = openSync(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return new DocumentLock(path, fd);
  } catch (error) { closeSync(fd); try { unlinkSync(lockPath); } catch { /* Preserve the original error. */ } throw error; }
}

export function acquireDocumentLock(path: string): DocumentLock {
  const lock = tryDocumentLock(path);
  if (!lock) throw new Error("Another Sideleaf writer holds this document's lock. Retry after it finishes; recover an abandoned lock only after checking its owner.");
  return lock;
}

export async function acquireDocumentLockAsync(path: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<DocumentLock> {
  const deadline = Date.now() + (options.timeoutMs ?? 2_000);
  while (true) {
    if (options.signal?.aborted) throw new Error("Document lock wait was cancelled.");
    const lock = tryDocumentLock(path);
    if (lock) return lock;
    if (Date.now() >= deadline) throw new Error("Another Sideleaf writer holds this document's lock. Retry after it finishes; recover an abandoned lock only after checking its owner.");
    await new Promise<void>((accept) => {
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", finish); accept(); };
      const timer = setTimeout(finish, 25);
      options.signal?.addEventListener("abort", finish, { once: true });
    });
  }
}

function readOptional(path: string): Buffer | null {
  try { return readFileSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
// Cheap on-disk fingerprint for the 2-second poll: metadata only, no content reads.
// Captured before the bytes are read, so a change that lands after the stat
// is always visible on the next poll. ctime plus device/inode catch
// same-size edits that restore mtime and files replaced with copied times.
// Windows uses the native FILE_BASIC_INFO change time and file identity because
// Bun exposes the creation time as ctime there. A writer with raw filesystem
// access can still reset all timestamps; the save path always re-reads content.
function diskStatKey(path: string): string | null {
  if (process.platform === "win32") {
    const primary = windowsFileKey(path);
    if (primary === null) return null;
    return `${primary}|${windowsFileKey(metadataPath(path)) ?? "-"}`;
  }
  let stat;
  try { stat = lstatSync(path); } catch { return null; }
  let sidecar = "-";
  try {
    const side = lstatSync(metadataPath(path));
    sidecar = `${side.mtimeMs}:${side.ctimeMs}:${side.dev}:${side.ino}:${side.size}`;
  } catch { /* no sidecar */ }
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mode & 0o777}|${sidecar}`;
}

function regularFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The file was replaced by a link or is no longer a regular file. Reopen it before saving.");
  if (stat.size > 2 * MAX_DOCUMENT_BYTES) throw new Error("This prototype supports documents up to 10 MiB.");
  return stat;
}

function readDisk(path: string): DiskState {
  const stat = regularFile(path);
  const statKey = diskStatKey(path) ?? "";
  const bytes = readFileSync(path);
  const sidecarPath = metadataPath(path);
  if (existsSync(sidecarPath)) regularFile(sidecarPath);
  const metadata = readOptional(sidecarPath);
  const mode = isWSL(path) ? Number.parseInt(linuxFileCommand(path, "stat", ["-c", "%a", "--"]), 8) & 0o777 : stat.mode & 0o777;
  return { bytes, metadata, mode, signature: `${hash(bytes)}:${metadata === null ? "none" : hash(metadata)}`, statKey };
}

export function decodeMarkdown(bytes: Uint8Array): { text: string; bom: boolean; lineEnding: "\n" | "\r\n" } {
  if (bytes.byteLength > 2 * MAX_DOCUMENT_BYTES) throw new Error("This prototype supports documents up to 10 MiB.");
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes); }
  catch { throw new Error("This file is not valid UTF-8. Convert a copy to UTF-8 before opening it in Sideleaf."); }
  if (text.includes("\u0000")) throw new Error("This file contains NUL characters and is not supported as Markdown.");
  // One scan classifies every line ending; only CRLF content allocates a
  // second copy, and that copy is the normalized text returned to the caller.
  let hasCRLF = false, loneCR = false, loneLF = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 13) { if (text.charCodeAt(i + 1) === 10) { hasCRLF = true; i++; } else loneCR = true; }
    else if (text.charCodeAt(i) === 10) loneLF = true;
  }
  if (loneCR || (hasCRLF && loneLF)) throw new Error("Mixed or classic Mac line endings are not supported yet. Sideleaf has left the file unchanged.");
  return { text: hasCRLF ? text.replaceAll("\r\n", "\n") : text, bom, lineEnding: hasCRLF ? "\r\n" : "\n" };
}

// The temporary file stays beside its target, so rename is atomic on a local
// filesystem. fsync completes before rename. An existing mode is preserved.
export function atomicWrite(path: string, bytes: Uint8Array, mode = 0o600): void {
  const temp = join(dirname(path), `.${basename(path)}.sideleaf-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    const wsl = isWSL(path);
    // Make the empty staging file private before any Markdown reaches it. POSIX
    // noclobber provides exclusive creation, including rejection of symlinks.
    if (wsl) linuxFileCommand(temp, "/bin/sh", ["-c", 'umask 077; set -C; : > "$1"', "sideleaf"]);
    fd = openSync(temp, wsl ? "r+" : "wx", mode);
    writeFileSync(fd, bytes);
    if (!wsl) fchmodSync(fd, mode);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    if (wsl) linuxFileCommand(temp, "chmod", [mode.toString(8), "--"]);
    renameSync(temp, path);
    if (wsl) linuxFileCommand(dirname(path), "sync", ["-f", "--"]);
    // Directory sync is supported on macOS/Linux. A failed sync is surfaced:
    // the bytes may have reached disk, but we must not report a durable save.
    if (process.platform !== "win32") {
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export class DocumentFile {
  id = randomUUID();
  path: string | null = null;
  private disk: DiskState | null = null;
  private statKey: string | null = null;
  private statChanged = false;
  private bom = false;
  private lineEnding: "\n" | "\r\n" = "\n";
  private draft: Draft = { text: "", comments: [] };
  private notice: string | null = null;
  private revisions: CommentRevision[] = [];
  private untitledName = "Untitled.md";

  revision(): string { return this.disk ? hash(this.disk.signature) : hash(""); }
  history(): CommentRevision[] { return structuredClone(this.revisions); }
  // Cheap metadata for titles and dialogs; snapshot() still clones the draft.
  get name(): string { return this.path ? basename(this.path) : this.untitledName; }

  snapshot(): DocumentSnapshot {
    return { ...structuredClone(this.draft), id: this.id, path: this.path, name: this.name, lineEnding: this.lineEnding, notice: this.notice };
  }

  static open(path: string, lock?: DocumentLock): DocumentFile {
    const file = new DocumentFile();
    file.path = realpathSync(path);
    lock?.assert(file.path);
    file.load();
    return file;
  }

  static fromDraft(draft: Draft, originalPath: string | null = null): DocumentFile {
    validateDraft(draft);
    const file = new DocumentFile();
    file.draft = structuredClone(draft);
    file.untitledName = isPlainText(originalPath) ? "Untitled.txt" : "Untitled.md";
    return file;
  }

  private load() {
    const disk = readDisk(this.path!);
    const decoded = decodeMarkdown(disk.bytes);
    const embedded = splitMetadata(decoded.text);
    decoded.text = embedded.text;
    const sourceBytes = Buffer.from(`${decoded.bom ? "\uFEFF" : ""}${decoded.text.replaceAll("\n", decoded.lineEnding)}`);
    if (sourceBytes.length > MAX_DOCUMENT_BYTES) throw new Error("Document source exceeds 10 MiB.");
    const legacy = parseMetadata(disk.metadata, true);
    if (embedded.metadata && disk.metadata && legacy.revisions.some((r) => !embedded.metadata!.revisions.some((e) => JSON.stringify(e) === JSON.stringify(r)))) {
      throw new Error("Embedded metadata and the legacy sidecar disagree. Preserve both and reconcile them before saving.");
    }
    const sidecar = embedded.metadata ?? legacy;
    this.revisions = sidecar.revisions;
    const sourceHash = hash(sourceBytes);
    const matched = sidecar.revisions.find((r) => r.sourceHash === sourceHash);
    const selected = matched ?? sidecar.revisions[0];
    const comments = (selected?.comments ?? []).map((c) => relocateComment(c, decoded.text, !!matched));
    validateDraft({ text: decoded.text, comments });
    this.disk = disk; this.statKey = disk.statKey; this.statChanged = false; this.bom = decoded.bom; this.lineEnding = decoded.lineEnding;
    this.draft = { text: decoded.text, comments };
    this.notice = selected && !matched ? "The file changed outside Sideleaf. Check the comment anchors; uncertain ones remain unanchored." :
      matched && matched !== sidecar.revisions[0] ? "Recovered the comment revision matching this file after an interrupted save." : null;
  }

  // Poll with metadata only while the fingerprint matches the last successful
  // comparison. Reuse both clean and conflicting results so a known conflict
  // stays visible without reading and hashing its bytes again. Missing files
  // and uncached fingerprints fall through to the full read, including errors.
  pollChanged(): boolean {
    if (!this.path) return false;
    if (this.statKey !== null && diskStatKey(this.path) === this.statKey) return this.statChanged;
    return this.changed();
  }

  // Explicit checks and the save path always compare current content.
  changed(): boolean {
    if (!this.path) return false;
    const disk = readDisk(this.path);
    const changed = disk.signature !== this.disk?.signature;
    this.statKey = disk.statKey;
    this.statChanged = changed;
    return changed;
  }

  reload(): DocumentSnapshot {
    if (!this.path) throw new Error("This document has no file to reload.");
    this.load();
    return this.snapshot();
  }

  rename(name: string): DocumentSnapshot {
    if (!this.path) throw new Error("Save this document before renaming it.");
    if (typeof name !== "string" || !name.trim() || name.length > 240 || /[\\/\x00-\x1f<>:"|?*]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || !/\.(md|markdown|mdown|txt)$/i.test(name)) throw new Error("Use a valid text filename ending in .md, .markdown, .mdown or .txt.");
    const source = this.path, target = join(dirname(source), name);
    if (target === source) return this.snapshot();
    if (existsSync(target)) throw new Error("That name already exists. For a case-only rename, use a different name first.");
    if (existsSync(metadataPath(source))) throw new Error("Save this document once to move its legacy comments into the file before renaming.");
    if (existsSync(metadataPath(target))) throw new Error("That name already has a Sideleaf sidecar.");
    const locks: { path: string; fd: number }[] = [];
    try {
      for (const path of [source, target]) {
        const lock = `${path}.sideleaf.lock`;
        const fd = openSync(lock, "wx", 0o600); locks.push({ path: lock, fd });
        writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      }
      if (this.changed()) throw new Error("The file changed on disk. Reload it or save a copy before renaming.");
      // An exclusive hard link reserves the new name without POSIX rename's
      // overwrite behavior. If the filesystem cannot do this, leave it alone.
      // Windows' WSL redirector rejects linkSync; let Linux create the same
      // exclusive link. -T prevents an existing directory becoming the target.
      if (isWSL(source)) linuxFileCommand(target, "ln", ["-T", "--", wslLocation(source)!.path]);
      else linkSync(source, target);
      try { unlinkSync(source); }
      catch (error) { unlinkSync(target); throw error; }
      this.path = target; this.statKey = diskStatKey(target);
      if (this.disk) this.disk.statKey = this.statKey ?? "";
      return this.snapshot();
    } finally { for (const lock of locks.reverse()) { closeSync(lock.fd); unlinkSync(lock.path); } }
  }

  trash(move: (path: string) => boolean): void {
    if (!this.path) throw new Error("This document has no file to move to Trash.");
    const path = this.path, lock = `${path}.sideleaf.lock`;
    const fd = openSync(lock, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      if (existsSync(metadataPath(path))) throw new Error("Save this document once to move its legacy comments into the file before moving it to Trash.");
      if (this.changed()) throw new Error("The file changed on disk. Reload it before moving it to Trash.");
      if (!move(path)) throw new Error("The system could not move this file to Trash. Your document is still open.");
    } finally { closeSync(fd); unlinkSync(lock); }
  }

  save(draft: Draft, target?: string, actor = "local-user", heldLock?: DocumentLock): DocumentSnapshot {
    validateDraft(draft);
    if (draft.text.includes("\r")) throw new Error("Editor text must use logical LF line endings.");
    const path = target ? join(realpathSync(dirname(resolve(target))), basename(target)) : this.path;
    if (!path) throw new Error("Choose a file location first.");
    // Cooperative desktop/CLI writers serialize the check-and-replace sequence.
    // An abandoned lock is deliberately never stolen based only on its age.
    const lock = heldLock ?? acquireDocumentLock(path);
    lock.assert(path);
    try {
      const samePath = path === this.path;
      const previousDisk = existsSync(path) ? readDisk(path) : null;
      if (!previousDisk && existsSync(metadataPath(path))) throw new Error("An existing Sideleaf sidecar is already at that location. Choose a new filename.");
      if (samePath && (!previousDisk || previousDisk.signature !== this.disk?.signature)) throw new Error("The file or comments changed on disk. Save a copy, or reload the disk version before saving.");
      // A selected Save As destination may already have independent annotations.
      // Refuse to overwrite those; a new filename is the safe path.
      if (!samePath && previousDisk && (previousDisk.metadata || splitMetadata(decodeMarkdown(previousDisk.bytes).text).metadata)) throw new Error("That destination already has Sideleaf comments. Choose a new filename.");
      const encode = (text: string) => Buffer.from(`${this.bom ? "\uFEFF" : ""}${text.replaceAll("\n", this.lineEnding)}`, "utf8");
      const source = encode(draft.text);
      if (source.length > MAX_DOCUMENT_BYTES) throw new Error("Document source exceeds 10 MiB.");
      // Reserve the block even on plain saves; never silently hide user content.
      if (splitMetadata(draft.text).metadata) throw new Error("Source contains reserved Sideleaf metadata.");
      const sourceHash = hash(source);
      const previousRevision = this.revisions[0];
      const unchanged = this.disk?.metadata === null && previousRevision?.sourceHash === sourceHash && JSON.stringify(previousRevision.comments) === JSON.stringify(draft.comments);
      const revision: CommentRevision = unchanged ? previousRevision : { sourceHash, comments: structuredClone(draft.comments), actor, savedAt: new Date().toISOString() };
      const revisions = [revision, ...this.revisions.filter((r) => JSON.stringify(r) !== JSON.stringify(revision))].slice(0, 3);
      const metadata: Metadata = { format: "sideleaf-comments", version: 1, revisions };
      const annotated = draft.comments.length > 0 || this.revisions.length > 0 || actor !== "local-user";
      const bytes = annotated ? encode(embedMetadata(draft.text, metadata)) : source;
      if (previousDisk ? readDisk(path).signature !== previousDisk.signature : existsSync(path)) throw new Error("The file changed during save. Your draft is still open; save a copy.");
      // Source and all comments now commit with one fsynced atomic replacement.
      // Avoid replacing an unchanged plain file (including its inode/mtime).
      if (!previousDisk || !previousDisk.bytes.equals(bytes)) atomicWrite(path, bytes, previousDisk?.mode ?? 0o644);
      // The verify read doubles as the post-save disk state: the bytes are
      // known-equal, the mode is exactly what atomicWrite was given, and the
      // sidecar is always absent or retired at this point.
      const statKey = diskStatKey(path) ?? "";
      const verified = readFileSync(path);
      if (!verified.equals(bytes)) throw new Error("The file changed immediately after save. Reload or save a copy.");
      const disk: DiskState = { bytes: verified, metadata: null, mode: previousDisk?.mode ?? 0o644, signature: `${bytes === source ? sourceHash : hash(bytes)}:none`, statKey };
      if (samePath && previousDisk?.metadata) {
        if (!readOptional(metadataPath(path))?.equals(previousDisk.metadata)) throw new Error("The sidecar changed during migration. Both copies were retained.");
        // Retire only after verifying the complete embedded file. Keep the old
        // recovery revisions in a uniquely named backup, never delete them.
        renameSync(metadataPath(path), `${metadataPath(path)}.migrated-${randomUUID()}`);
      }
      this.revisions = annotated ? revisions : [];
      this.disk = disk; this.statKey = disk.statKey; this.statChanged = false;
    } finally { if (!heldLock) lock.release(); }

    this.path = path;
    this.draft = structuredClone(draft);
    this.notice = null;
    return this.snapshot();
  }
}
