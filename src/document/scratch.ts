import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWrite } from "./files.ts";
import { MAX_DOCUMENT_BYTES, validateDraft, type Draft } from "../shared/contracts.ts";

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
