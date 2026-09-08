import { MAX_DOCUMENT_BYTES, SAVE_CHUNK_CHARACTERS, validateDraft, type Draft, type SaveChunk } from "../shared/contracts.ts";

// Allow JSON escaping of a 10 MiB source plus its bounded comment sidecar.
const MAX_SERIALIZED_CHARACTERS = 8 * MAX_DOCUMENT_BYTES;
export class SaveTransfer {
  private pending: { id: string; total: number; length: number; parts: string[] } | null = null;

  clear(transferId?: string) {
    if (!transferId || this.pending?.id === transferId) this.pending = null;
  }

  append(part: SaveChunk) {
    if (!part || typeof part.transferId !== "string" || !/^[\w-]{1,100}$/.test(part.transferId) ||
      !Number.isInteger(part.index) || !Number.isInteger(part.total) || part.total < 1 ||
      part.total > Math.ceil(MAX_SERIALIZED_CHARACTERS / SAVE_CHUNK_CHARACTERS) ||
      part.index < 0 || part.index >= part.total || typeof part.text !== "string" ||
      !part.text.length || part.text.length > SAVE_CHUNK_CHARACTERS) throw new Error("Invalid Save transfer.");
    if (part.index === 0) this.pending = { id: part.transferId, total: part.total, length: 0, parts: [] };
    const pending = this.pending;
    if (!pending || pending.id !== part.transferId || pending.total !== part.total || pending.parts.length !== part.index) {
      throw new Error("Save transfer arrived out of order. Please save again.");
    }
    if (pending.length + part.text.length > MAX_SERIALIZED_CHARACTERS) { this.clear(); throw new Error("Save transfer is too large."); }
    pending.parts.push(part.text); pending.length += part.text.length;
  }

  take(transferId: string): Draft {
    const pending = this.pending;
    if (!pending || pending.id !== transferId || pending.parts.length !== pending.total) throw new Error("Save transfer is incomplete. Please save again.");
    this.clear();
    const draft: unknown = JSON.parse(pending.parts.join(""));
    validateDraft(draft);
    return draft;
  }
}
