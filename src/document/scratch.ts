import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWrite } from "./files.ts";
import { MAX_DOCUMENT_BYTES, validateDraft, type Draft, type PendingComment } from "../shared/contracts.ts";

const MAX_SCRATCH_BYTES = 8 * MAX_DOCUMENT_BYTES;
type ScratchEnvelope = {
  format: "sideleaf-scratch";
  version: 1;
  savedAt: string;
  draft: Draft;
};

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
    if (envelope.format !== "sideleaf-scratch" || envelope.version !== 1 ||
      typeof envelope.savedAt !== "string" || envelope.savedAt.length > 40 || !Number.isFinite(Date.parse(envelope.savedAt))) {
      throw new Error("The untitled recovery record has an unsupported format.");
    }
    validateDraft(envelope.draft);
    return structuredClone(envelope.draft);
  }

  save(draft: Draft): void {
    validateDraft(draft);
    const envelope: ScratchEnvelope = {
      format: "sideleaf-scratch",
      version: 1,
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

export type RecoveryRecord = { id: string; originalPath: string | null; revision: string | null; draft: Draft; pending?: PendingComment | null };

function validatePending(draft: Draft, pending?: PendingComment | null) {
  if (!pending) return;
  if (typeof pending.valid !== "boolean") throw new Error("Invalid pending comment.");
  // A stale selection still needs to retain the writer's unfinished thought.
  validateDraft({ text: draft.text, comments: [{ id: "pending", body: pending.body, createdAt: "recovery", anchor: { ...pending.anchor, state: "orphaned" } }] });
  if (pending.valid) validateDraft({ text: draft.text, comments: [{ id: "pending", body: pending.body, createdAt: "recovery", anchor: pending.anchor }] });
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
    const bytes = Buffer.from(JSON.stringify({ format: "sideleaf-recovery", version: 1, ...record }));
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
        if (value.format !== "sideleaf-recovery" || value.version !== 1 || `${value.id}.json` !== name ||
          !(value.originalPath === null || typeof value.originalPath === "string" && value.originalPath.length <= 32_768) ||
          !(value.revision === null || typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision))) throw new Error("Invalid recovery record.");
        validateDraft(value.draft);
        validatePending(value.draft, value.pending);
        records.push({ id: value.id, originalPath: value.originalPath, revision: value.revision, draft: value.draft, pending: value.pending ?? null });
      } catch { errors.push(`Could not restore ${name}. Its recovery record was left untouched.`); }
    }
    return { records, errors };
  }
  clear(id: string) {
    try { unlinkSync(this.path(id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  clearAll() { for (const record of this.load().records) this.clear(record.id); }
}
