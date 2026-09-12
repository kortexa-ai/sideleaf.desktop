import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWrite } from "./files.ts";
import { migrateComment } from "./metadata.ts";
import { MAX_DOCUMENT_BYTES, validateDraft, type Comment, type Draft, type PendingComment, type PendingReview, type ThreadComposer } from "../shared/contracts.ts";

const MAX_SCRATCH_BYTES = 8 * MAX_DOCUMENT_BYTES;
type ScratchEnvelope = {
  format: "sideleaf-scratch";
  version: 2;
  savedAt: string;
  draft: Draft;
};
type LegacyDraft = { text: string; comments: Comment[] };
const migrateDraft = (draft: LegacyDraft): Draft => ({ text: draft.text, threads: draft.comments.map(migrateComment) });

export class ScratchStore {
  constructor(readonly path: string) {}

  load(): Draft | null {
    if (!existsSync(this.path)) return null;
    const stat = lstatSync(this.path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The untitled recovery record is not a regular file.");
    if (stat.size > MAX_SCRATCH_BYTES) throw new Error("The untitled recovery record is too large.");
    const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
    if (!value || typeof value !== "object") throw new Error("The untitled recovery record is invalid.");
    const envelope = value as Partial<ScratchEnvelope>;
    if (envelope.format !== "sideleaf-scratch" || ![1, 2].includes(envelope.version as number) ||
      typeof envelope.savedAt !== "string" || envelope.savedAt.length > 40 || !Number.isFinite(Date.parse(envelope.savedAt))) {
      throw new Error("The untitled recovery record has an unsupported format.");
    }
    const draft = (envelope.version as number) === 1 ? migrateDraft(envelope.draft as unknown as LegacyDraft) : envelope.draft;
    validateDraft(draft);
    return structuredClone(draft);
  }

  save(draft: Draft): void {
    validateDraft(draft);
    const envelope: ScratchEnvelope = {
      format: "sideleaf-scratch",
      version: 2,
      savedAt: new Date().toISOString(),
      draft: structuredClone(draft),
    };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
    if (bytes.length > MAX_SCRATCH_BYTES) throw new Error("The untitled recovery record is too large.");
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    atomicWrite(this.path, bytes, 0o600);
  }

  clear(): void {
    try { unlinkSync(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

export type RecoveryRecord = { id: string; originalPath: string | null; revision: string | null; draft: Draft; pending?: PendingReview | null };

function validateComment(draft: Draft, pending?: PendingComment | null) {
  if (!pending) return;
  if (typeof pending.valid !== "boolean") throw new Error("Invalid pending comment.");
  // A stale selection still needs to retain the writer's unfinished thought.
  const root = { id: "pending", body: pending.body, createdAt: "recovery", author: "recovery" };
  validateDraft({ text: draft.text, threads: [{ id: "pending", state: "open", messages: [root], anchor: { ...pending.anchor, state: "orphaned" } }] });
  if (pending.valid) validateDraft({ text: draft.text, threads: [{ id: "pending", state: "open", messages: [root], anchor: pending.anchor }] });
}
function validateComposer(_draft: Draft, composer?: ThreadComposer | null) {
  if (!composer) return;
  if (!["reply", "edit"].includes(composer.kind) || typeof composer.threadId !== "string" || !composer.threadId || composer.threadId.length > 100 ||
    composer.kind === "edit" && (typeof composer.messageId !== "string" || !composer.messageId || composer.messageId.length > 100) ||
    composer.kind === "reply" && composer.messageId !== undefined || typeof composer.body !== "string" || composer.body.length > 20_000 ||
    typeof composer.baseSemantic !== "string" || composer.baseSemantic.length > MAX_DOCUMENT_BYTES) throw new Error("Invalid pending thread composer.");
  // A concurrent actor may remove the target. Preserve the unfinished body so
  // the UI can show an explicit unavailable-target state instead of losing it.
}
function validatePending(draft: Draft, pending?: PendingReview | null) {
  if (!pending) return;
  if (typeof pending !== "object") throw new Error("Invalid pending review.");
  validateComment(draft, pending.comment);
  validateComposer(draft, pending.composer);
}

/** Independent records prevent one buffer's save from clearing another's draft. */
export class RecoveryStore {
  constructor(readonly directory: string) {}
  private path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid recovery document ID.");
    return join(this.directory, `${id}.json`);
  }
  save(record: RecoveryRecord) {
    validateDraft(record.draft);
    validatePending(record.draft, record.pending);
    const path = this.path(record.id);
    const bytes = Buffer.from(JSON.stringify({ format: "sideleaf-recovery", version: 2, ...record }));
    if (bytes.length > MAX_SCRATCH_BYTES) throw new Error("The recovery record is too large.");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    atomicWrite(path, bytes, 0o600);
  }
  load(): { records: RecoveryRecord[]; errors: string[] } {
    if (!existsSync(this.directory)) return { records: [], errors: [] };
    const records: RecoveryRecord[] = [], errors: string[] = [];
    const names = readdirSync(this.directory).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name));
    for (const name of names) {
      try {
        const path = join(this.directory, name), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SCRATCH_BYTES) throw new Error("Invalid recovery file.");
        const value = JSON.parse(readFileSync(path, "utf8"));
        if (value.format !== "sideleaf-recovery" || ![1, 2].includes(value.version) || `${value.id}.json` !== name ||
          !(value.originalPath === null || typeof value.originalPath === "string" && value.originalPath.length <= 32_768) ||
          !(value.revision === null || typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision))) throw new Error("Invalid recovery record.");
        const draft = value.version === 1 ? migrateDraft(value.draft) : value.draft;
        const pending = value.version === 1 ? { comment: value.pending ?? null } : value.pending ?? null;
        validateDraft(draft);
        validatePending(draft, pending);
        records.push({ id: value.id, originalPath: value.originalPath, revision: value.revision, draft, pending });
      } catch { errors.push(`Could not restore ${name}. Its recovery record was left untouched.`); }
    }
    return { records, errors };
  }
  clear(id: string) {
    try { unlinkSync(this.path(id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  clearAll() { for (const record of this.load().records) this.clear(record.id); }
}
