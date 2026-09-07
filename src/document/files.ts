import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, fchmodSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MAX_DOCUMENT_BYTES, validateDraft, type Comment, type Draft, type DocumentSnapshot } from "../shared/contracts.ts";
import { relocateComment } from "./anchors.ts";

type CommentRevision = { sourceHash: string; comments: Comment[] };
type Sidecar = { format: "sideleaf-comments"; version: 1; revisions: CommentRevision[] };
type DiskState = { bytes: Buffer; metadata: Buffer | null; mode: number; signature: string };

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const metadataPath = (path: string) => `${path}.sideleaf.json`;

function readOptional(path: string): Buffer | null {
  try { return readFileSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function regularFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The file was replaced by a link or is no longer a regular file. Reopen it before saving.");
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error("This prototype supports documents up to 10 MiB.");
  return stat;
}

function readDisk(path: string): DiskState {
  const stat = regularFile(path);
  const bytes = readFileSync(path);
  const sidecarPath = metadataPath(path);
  if (existsSync(sidecarPath)) regularFile(sidecarPath);
  const metadata = readOptional(sidecarPath);
  return { bytes, metadata, mode: stat.mode & 0o777, signature: `${hash(bytes)}:${metadata === null ? "none" : hash(metadata)}` };
}

export function decodeMarkdown(bytes: Uint8Array): { text: string; bom: boolean; lineEnding: "\n" | "\r\n" } {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("This prototype supports documents up to 10 MiB.");
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

function parseSidecar(bytes: Buffer | null): Sidecar {
  if (bytes === null) return { format: "sideleaf-comments", version: 1, revisions: [] };
  let data: Sidecar;
  try { data = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("The Sideleaf comment sidecar is not valid JSON. Repair or move it before opening this document; it will not be overwritten."); }
  if (data?.format !== "sideleaf-comments" || data.version !== 1 || !Array.isArray(data.revisions) || data.revisions.length > 2) {
    throw new Error("This comment sidecar uses an unsupported format. It will not be overwritten.");
  }
  for (const revision of data.revisions) {
    if (typeof revision?.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(revision.sourceHash) || !Array.isArray(revision.comments)) {
      throw new Error("Invalid comment revision in sidecar.");
    }
    // Stored offsets may refer to a prior source revision. Validate their shape
    // without treating an old range as authority over the current file.
    validateDraft({ text: "", comments: revision.comments.map((c) => ({ ...c, anchor: { ...c.anchor, state: "orphaned" } })) });
    if (revision.comments.some((c) => !["attached", "orphaned"].includes(c.anchor.state))) throw new Error("Invalid stored anchor state.");
  }
  return data;
}

// The temporary file stays beside its target, so rename is atomic on a local
// filesystem. fsync completes before rename. An existing mode is preserved.
export function atomicWrite(path: string, bytes: Uint8Array, mode = 0o600): void {
  const temp = join(dirname(path), `.${basename(path)}.sideleaf-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", mode);
    writeFileSync(fd, bytes);
    fchmodSync(fd, mode);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, path);
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

  snapshot(): DocumentSnapshot {
    return { ...this.draft, id: this.id, path: this.path, name: this.path ? basename(this.path) : "Untitled.md", lineEnding: this.lineEnding, notice: this.notice };
  }

  static open(path: string): DocumentFile {
    const file = new DocumentFile();
    file.path = realpathSync(path);
    file.load();
    return file;
  }

  private load() {
    const disk = readDisk(this.path!);
    const decoded = decodeMarkdown(disk.bytes);
    const sidecar = parseSidecar(disk.metadata);
    const sourceHash = hash(disk.bytes);
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

  save(draft: Draft, target?: string): DocumentSnapshot {
    validateDraft(draft);
    if (draft.text.includes("\r")) throw new Error("Editor text must use logical LF line endings.");
    const path = target ? join(realpathSync(dirname(resolve(target))), basename(target)) : this.path;
    if (!path) throw new Error("Choose a file location first.");
    const samePath = path === this.path;
    const previousDisk = existsSync(path) ? readDisk(path) : null;
    if (!previousDisk && existsSync(metadataPath(path))) throw new Error("An existing Sideleaf sidecar is already at that location. Choose a new filename.");
    if (samePath && (!previousDisk || previousDisk.signature !== this.disk?.signature)) {
      throw new Error("The file or comments changed on disk. Save a copy, or reload the disk version before saving.");
    }
    // A selected Save As destination may already have independent annotations.
    // Refuse to overwrite those; a new filename is the safe prototype path.
    if (!samePath && previousDisk?.metadata) throw new Error("That destination already has Sideleaf comments. Choose a new filename.");
    const encodedText = draft.text.replaceAll("\n", this.lineEnding);
    const bytes = Buffer.from(`${this.bom ? "\uFEFF" : ""}${encodedText}`, "utf8");
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("This prototype supports documents up to 10 MiB.");
    const revision: CommentRevision = { sourceHash: hash(bytes), comments: draft.comments };
    const oldRevisions = parseSidecar(samePath ? previousDisk?.metadata ?? null : null).revisions;
    const oldRevision = previousDisk ? oldRevisions.find((r) => r.sourceHash === hash(previousDisk.bytes)) : undefined;
    const revisions = [revision];
    if (previousDisk && hash(previousDisk.bytes) !== revision.sourceHash) {
      revisions.push(oldRevision ?? { sourceHash: hash(previousDisk.bytes), comments: samePath ? this.draft.comments : [] });
    }
    const metadata = Buffer.from(`${JSON.stringify({ format: "sideleaf-comments", version: 1, revisions } satisfies Sidecar, null, 2)}\n`);
    if (metadata.length > MAX_DOCUMENT_BYTES) throw new Error("The comment sidecar exceeds the prototype's 10 MiB limit. Nothing was saved.");
    // Commit comments first with both source revisions. A crash or failed source
    // write leaves a complete comment set for the old file; a successful source
    // rename selects the new set. No parse/reserialize of Markdown takes place.
    if (draft.comments.length || previousDisk?.metadata) atomicWrite(metadataPath(path), metadata);
    try {
      // Check source bytes again after the metadata write; never hide a writer
      // that raced the first check. The editor retains its draft on every error.
      if (previousDisk && hash(readFileSync(path)) !== hash(previousDisk.bytes)) throw new Error("The source changed during save. Your draft is still open; save a copy.");
      if (!previousDisk && existsSync(path)) throw new Error("A file appeared at this location during save. Choose a new filename.");
      atomicWrite(path, bytes, previousDisk?.mode ?? 0o644);
    } catch (error) {
      this.notice = "Save did not finish. The draft is still open and the previous comment revision remains in the sidecar.";
      throw error;
    }
    this.path = path;
    this.disk = readDisk(path);
    this.draft = structuredClone(draft);
    this.notice = null;
    return this.snapshot();
  }
}
