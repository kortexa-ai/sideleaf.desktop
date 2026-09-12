import { makeAnchor } from "../document/anchors.ts";
import { validateDraft, type CollaborationTarget, type Draft } from "../shared/contracts.ts";

export const COLLABORATION_CONTRACT = "sideleaf-collaboration/v1" as const;
export const FOUNDATION_REPLACE_CHARACTERS = 8_000;

export type DocumentTarget = CollaborationTarget;
export type ReplaceOperation = { kind: "replace"; from: number; to: number; text: string };
export type ApplyEnvelope = { operations: [ReplaceOperation] };
export type AppliedChange = { from: number; to: number; inserted: number };

export class CollaborationError extends Error {
  constructor(message: string, readonly code: "BUSY" | "CONFLICT" | "NOT_FOUND" | "INVALID" | "UNCERTAIN", readonly retryable = false) {
    super(message);
  }
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CollaborationError("Offsets must be nonnegative UTF-16 integers.", "INVALID");
  return value as number;
}

export function parseApplyEnvelope(value: unknown): ApplyEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollaborationError("Apply input must be a JSON object.", "INVALID");
  const operations = (value as { operations?: unknown }).operations;
  if (!Array.isArray(operations) || operations.length !== 1) throw new CollaborationError("This foundation accepts exactly one replace operation.", "INVALID");
  const candidate = operations[0];
  if (!candidate || typeof candidate !== "object" || (candidate as { kind?: unknown }).kind !== "replace") {
    throw new CollaborationError("The operation must be a replace.", "INVALID");
  }
  const operation = candidate as Record<string, unknown>;
  const from = integer(operation.from), to = integer(operation.to);
  if (typeof operation.text !== "string" || operation.text.includes("\r") || operation.text.length > FOUNDATION_REPLACE_CHARACTERS) {
    throw new CollaborationError(`Invalid replacement text; the foundation accepts up to ${FOUNDATION_REPLACE_CHARACTERS.toLocaleString("en-US")} logical-LF characters.`, "INVALID");
  }
  return { operations: [{ kind: "replace", from, to, text: operation.text }] };
}

function splitSurrogate(text: string, offset: number): boolean {
  return offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
}

/** Evaluate the same guarded operation before either a disk save or editor dispatch. */
export function evaluateApply(draft: Draft, envelopeValue: unknown, expectedRevision: string, currentRevision: string): { draft: Draft; change: AppliedChange } {
  validateDraft(draft);
  if (expectedRevision !== currentRevision) throw new CollaborationError("Revision conflict: reread the document before applying.", "CONFLICT");
  const envelope = parseApplyEnvelope(envelopeValue);
  const operation = envelope.operations[0];
  if (operation.to < operation.from || operation.to > draft.text.length || splitSurrogate(draft.text, operation.from) || splitSurrogate(draft.text, operation.to)) {
    throw new CollaborationError("The replacement range is outside the document or splits a Unicode character.", "INVALID");
  }
  const next = structuredClone(draft);
  const text = draft.text.slice(0, operation.from) + operation.text + draft.text.slice(operation.to);
  const delta = operation.text.length - (operation.to - operation.from);
  next.comments = next.comments.map((comment) => {
    const anchor = comment.anchor;
    if (anchor.state === "orphaned") return comment;
    if ((operation.from < anchor.to && operation.to > anchor.from) || (operation.from === operation.to && operation.from > anchor.from && operation.from < anchor.to)) {
      return { ...comment, anchor: { ...anchor, state: "orphaned" as const } };
    }
    const from = anchor.from + (operation.to <= anchor.from ? delta : 0);
    const to = anchor.to + (operation.to < anchor.to || (operation.to === anchor.to && operation.from < operation.to) ? delta : 0);
    return { ...comment, anchor: makeAnchor(text, from, to) };
  });
  next.text = text;
  validateDraft(next);
  return { draft: next, change: { from: operation.from, to: operation.to, inserted: operation.text.length } };
}

export function liveRevision(instanceId: string, documentId: string, generation: number): string {
  return `sl1.${instanceId}.${documentId}.${generation}`;
}

export function isLiveRevision(value: string): boolean {
  return /^sl1\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[0-9]+$/.test(value);
}
