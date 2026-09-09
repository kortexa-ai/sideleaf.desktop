import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, fchmodSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_DOCUMENT_BYTES, validateDraft, type Draft, type DocumentSnapshot } from "../shared/contracts.ts";
import { relocateComment } from "./anchors.ts";

import { hash, parseMetadata, splitMetadata, embedMetadata, type Metadata, type CommentRevision } from "./metadata.ts";
type DiskState = { bytes: Buffer; metadata: Buffer | null; mode: number; signature: string };

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

function readOptional(path: string): Buffer | null {
  try { return readFileSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function regularFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The file was replaced by a link or is no longer a regular file. Reopen it before saving.");
  if (stat.size > 2 * MAX_DOCUMENT_BYTES) throw new Error("This prototype supports documents up to 10 MiB.");
  return stat;
}

function readDisk(path: string): DiskState {
  const stat = regularFile(path);
  const bytes = readFileSync(path);
  const sidecarPath = metadataPath(path);
  if (existsSync(sidecarPath)) regularFile(sidecarPath);
  const metadata = readOptional(sidecarPath);
  const mode = isWSL(path) ? Number.parseInt(linuxFileCommand(path, "stat", ["-c", "%a", "--"]), 8) & 0o777 : stat.mode & 0o777;
  return { bytes, metadata, mode, signature: `${hash(bytes)}:${metadata === null ? "none" : hash(metadata)}` };
}

export function decodeMarkdown(bytes: Uint8Array): { text: string; bom: boolean; lineEnding: "\n" | "\r\n" } {
  if (bytes.byteLength > 2 * MAX_DOCUMENT_BYTES) throw new Error("This prototype supports documents up to 10 MiB.");
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes); }
  catch { throw new Error("This file is not valid UTF-8. Convert a copy to UTF-8 before opening it in Sideleaf."); }
  if (text.includes("\u0000")) throw new Error("This file contains NUL characters and is not supported as Markdown.");
  const withoutCRLF = text.replaceAll("\r\n", "");
  if (withoutCRLF.includes("\r") || (text.includes("\r\n") && withoutCRLF.includes("\n"))) {
    throw new Error("Mixed or classic Mac line endings are not supported yet. Sideleaf has left the file unchanged.");
  }
  return { text: text.replaceAll("\r\n", "\n"), bom, lineEnding: text.includes("\r\n") ? "\r\n" : "\n" };
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
  private bom = false;
  private lineEnding: "\n" | "\r\n" = "\n";
  private draft: Draft = { text: "", comments: [] };
  private notice: string | null = null;
  private revisions: CommentRevision[] = [];

  revision(): string { return this.disk ? hash(this.disk.signature) : hash(""); }
  history(): CommentRevision[] { return structuredClone(this.revisions); }

  snapshot(): DocumentSnapshot {
    return { ...structuredClone(this.draft), id: this.id, path: this.path, name: this.path ? basename(this.path) : "Untitled.md", lineEnding: this.lineEnding, notice: this.notice };
  }

  static open(path: string): DocumentFile {
    const file = new DocumentFile();
    file.path = realpathSync(path);
    file.load();
    return file;
  }

  static fromDraft(draft: Draft): DocumentFile {
    validateDraft(draft);
    const file = new DocumentFile();
    file.draft = structuredClone(draft);
    file.notice = "Restored your untitled draft.";
    return file;
  }

  private load() {
    const disk = readDisk(this.path!);
    const decoded = decodeMarkdown(disk.bytes);
    const embedded = splitMetadata(decoded.text);
    decoded.text = embedded.text;
    const sourceBytes = Buffer.from(`${decoded.bom ? "\uFEFF" : ""}${decoded.text.replaceAll("\n", decoded.lineEnding)}`);
    if (sourceBytes.length > MAX_DOCUMENT_BYTES) throw new Error("Markdown source exceeds 10 MiB.");
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
    this.disk = disk; this.bom = decoded.bom; this.lineEnding = decoded.lineEnding;
    this.draft = { text: decoded.text, comments };
    this.notice = selected && !matched ? "The file changed outside Sideleaf. Check the comment anchors; uncertain ones remain unanchored." :
      matched && matched !== sidecar.revisions[0] ? "Recovered the comment revision matching this file after an interrupted save." : null;
  }

  changed(): boolean { return !!this.path && readDisk(this.path).signature !== this.disk?.signature; }

  reload(): DocumentSnapshot {
    if (!this.path) throw new Error("This document has no file to reload.");
    this.load(); this.id = randomUUID();
    return this.snapshot();
  }

  save(draft: Draft, target?: string, actor = "local-user"): DocumentSnapshot {
    validateDraft(draft);
    if (draft.text.includes("\r")) throw new Error("Editor text must use logical LF line endings.");
    const path = target ? join(realpathSync(dirname(resolve(target))), basename(target)) : this.path;
    if (!path) throw new Error("Choose a file location first.");
    // Cooperative desktop/CLI writers serialize the check-and-replace sequence.
    // An abandoned lock is deliberately never stolen based only on its age.
    const lock = `${path}.sideleaf.lock`;
    let fd: number;
    try { fd = openSync(lock, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Another Sideleaf writer holds this document's lock. Retry after it finishes; recover an abandoned lock only after checking its owner.");
      throw error;
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      const samePath = path === this.path;
      const previousDisk = existsSync(path) ? readDisk(path) : null;
      if (!previousDisk && existsSync(metadataPath(path))) throw new Error("An existing Sideleaf sidecar is already at that location. Choose a new filename.");
      if (samePath && (!previousDisk || previousDisk.signature !== this.disk?.signature)) throw new Error("The file or comments changed on disk. Save a copy, or reload the disk version before saving.");
      // A selected Save As destination may already have independent annotations.
      // Refuse to overwrite those; a new filename is the safe path.
      if (!samePath && previousDisk && (previousDisk.metadata || splitMetadata(decodeMarkdown(previousDisk.bytes).text).metadata)) throw new Error("That destination already has Sideleaf comments. Choose a new filename.");
      const encode = (text: string) => Buffer.from(`${this.bom ? "\uFEFF" : ""}${text.replaceAll("\n", this.lineEnding)}`, "utf8");
      const source = encode(draft.text);
      if (source.length > MAX_DOCUMENT_BYTES) throw new Error("Markdown source exceeds 10 MiB.");
      // Reserve the block even on plain saves; never silently hide user content.
      if (splitMetadata(draft.text).metadata) throw new Error("Source contains reserved Sideleaf metadata.");
      const previousRevision = this.revisions[0];
      const unchanged = this.disk?.metadata === null && previousRevision?.sourceHash === hash(source) && JSON.stringify(previousRevision.comments) === JSON.stringify(draft.comments);
      const revision: CommentRevision = unchanged ? previousRevision : { sourceHash: hash(source), comments: structuredClone(draft.comments), actor, savedAt: new Date().toISOString() };
      const revisions = [revision, ...this.revisions.filter((r) => JSON.stringify(r) !== JSON.stringify(revision))].slice(0, 3);
      const metadata: Metadata = { format: "sideleaf-comments", version: 1, revisions };
      const annotated = draft.comments.length > 0 || this.revisions.length > 0 || actor !== "local-user";
      const bytes = annotated ? encode(embedMetadata(draft.text, metadata)) : source;
      if (previousDisk ? readDisk(path).signature !== previousDisk.signature : existsSync(path)) throw new Error("The file changed during save. Your draft is still open; save a copy.");
      // Source and all comments now commit with one fsynced atomic replacement.
      // Avoid replacing an unchanged plain file (including its inode/mtime).
      if (!previousDisk || !previousDisk.bytes.equals(bytes)) atomicWrite(path, bytes, previousDisk?.mode ?? 0o644);
      if (!readFileSync(path).equals(bytes)) throw new Error("The file changed immediately after save. Reload or save a copy.");
      if (samePath && previousDisk?.metadata) {
        if (!readOptional(metadataPath(path))?.equals(previousDisk.metadata)) throw new Error("The sidecar changed during migration. Both copies were retained.");
        // Retire only after verifying the complete embedded file. Keep the old
        // recovery revisions in a uniquely named backup, never delete them.
        renameSync(metadataPath(path), `${metadataPath(path)}.migrated-${randomUUID()}`);
      }
      this.revisions = annotated ? revisions : [];
    } finally { closeSync(fd); unlinkSync(lock); }

    this.path = path;
    this.disk = readDisk(path);
    this.draft = structuredClone(draft);
    this.notice = null;
    return this.snapshot();
  }
}
