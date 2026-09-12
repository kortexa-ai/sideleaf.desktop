import { createHash } from "node:crypto";
import { MAX_DOCUMENT_BYTES, validateDraft, type Comment, type ReviewThread } from "../shared/contracts.ts";

export type ThreadRevision = { sourceHash: string; threads: ReviewThread[]; actor?: string; savedAt?: string };
export type CommentRevision = ThreadRevision;
export type Metadata = { format: "sideleaf-comments"; version: 3; revisions: ThreadRevision[] };
type LegacyRevision = { sourceHash: string; comments: Comment[]; actor?: string; savedAt?: string };
type LegacyMetadata = { format: "sideleaf-comments"; version: 1; revisions: LegacyRevision[] };
type ThreadMetadata = { format: "sideleaf-comments"; version: 2; revisions: ThreadRevision[] };
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const marker = "<!-- sideleaf:metadata";
const prefix = `\n\n${marker}\n`;
const suffix = "\n-->\n";

export function migrateComment(comment: Comment): ReviewThread {
  const { anchor, ...message } = comment;
  return { id: comment.id, anchor: structuredClone(anchor), state: "open", messages: [structuredClone(message)] };
}

function validateRevision(revision: ThreadRevision) {
  if (typeof revision?.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(revision.sourceHash) || !Array.isArray(revision.threads)) throw new Error("Invalid thread revision.");
  if (revision.actor !== undefined && (typeof revision.actor !== "string" || !revision.actor.trim() || revision.actor.length > 200)) throw new Error("Invalid revision actor.");
  if (revision.savedAt !== undefined && (typeof revision.savedAt !== "string" || revision.savedAt.length > 40)) throw new Error("Invalid revision timestamp.");
  // Historical ranges are not authority over the current source.
  validateDraft({ text: "", threads: revision.threads.map((thread) => ({ ...thread, anchor: { ...thread.anchor, state: "orphaned" } })) });
  if (revision.threads.some((thread) => !["attached", "orphaned"].includes(thread.anchor.state))) throw new Error("Invalid stored anchor state.");
}

export function parseMetadata(bytes: Uint8Array | null, legacy = false): Metadata {
  if (bytes === null) return { format: "sideleaf-comments", version: 3, revisions: [] };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("Sideleaf metadata exceeds 10 MiB. Nothing was changed.");
  let data: Metadata | ThreadMetadata | LegacyMetadata;
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Sideleaf metadata is not valid JSON. It will not be overwritten."); }
  if (data?.format !== "sideleaf-comments" || ![1, 2, 3].includes(data.version) || !Array.isArray(data.revisions) || data.revisions.length > (legacy ? 2 : 3) || !data.revisions.length) {
    throw new Error("Sideleaf metadata uses an unsupported format. It will not be overwritten.");
  }
  const revisions: ThreadRevision[] = data.version === 1
    ? data.revisions.map((revision) => {
      if (!Array.isArray(revision.comments)) throw new Error("Invalid comment revision.");
      return { sourceHash: revision.sourceHash, actor: revision.actor, savedAt: revision.savedAt, threads: revision.comments.map(migrateComment) };
    })
    : data.revisions;
  for (const revision of revisions) validateRevision(revision);
  return { format: "sideleaf-comments", version: 3, revisions };
}

// The exact terminal block is reserved. Its two leading newlines belong to the
// envelope, so source without a final newline round-trips byte for byte.
export function splitMetadata(text: string): { text: string; metadata: Metadata | null } {
  const start = text.indexOf(prefix);
  if (start < 0) {
    if (/(^|\n)<!-- sideleaf:metadata/.test(text)) throw new Error("Malformed Sideleaf metadata block. Nothing was changed.");
    return { text, metadata: null };
  }
  if (!text.endsWith(suffix) || text.indexOf(prefix, start + prefix.length) >= 0) throw new Error("Malformed or multiple Sideleaf metadata blocks. Nothing was changed.");
  const json = text.slice(start + prefix.length, -suffix.length);
  return { text: text.slice(0, start), metadata: parseMetadata(Buffer.from(json)) };
}

export function embedMetadata(text: string, metadata: Metadata): string {
  if (splitMetadata(text).metadata) throw new Error("Editor source contains a reserved Sideleaf metadata block.");
  // Escape HTML delimiters, including the forbidden HTML-comment double hyphen.
  const json = JSON.stringify(metadata).replace(/[<>&-]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (Buffer.byteLength(json) > MAX_DOCUMENT_BYTES) throw new Error("Sideleaf metadata exceeds 10 MiB. Nothing was saved.");
  return `${text}${prefix}${json}${suffix}`;
}
