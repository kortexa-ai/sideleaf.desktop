import { makeAnchor } from "../document/anchors.ts";
import { MAX_COMMENTS, validateDraft, type CollaborationTarget, type Draft, type ReviewThread } from "../shared/contracts.ts";

export const COLLABORATION_CONTRACT = "sideleaf-collaboration/v1" as const;
export const FOUNDATION_REPLACE_CHARACTERS = 8_000;

export type DocumentTarget = CollaborationTarget;
export type ReplaceOperation = { kind: "replace"; from: number; to: number; text: string };
export type ThreadOperation =
  | { kind: "thread-add"; from: number; to: number; body: string }
  | { kind: "thread-reply"; threadId: string; body: string }
  | { kind: "thread-message-update"; threadId: string; messageId: string; body: string }
  | { kind: "thread-message-delete"; threadId: string; messageId: string }
  | { kind: "thread-resolve" | "thread-reopen" | "thread-delete"; threadId: string };
export type ApplyOperation = ReplaceOperation | ThreadOperation;
export type ApplyEnvelope = { operations: [ApplyOperation] };
export type AppliedChange = { from: number; to: number; inserted: number };
export type ApplyGuards = { actor: string; currentRevision: string; ifRevision?: string; ifThreadRevision?: string };

export class CollaborationError extends Error {
  constructor(message: string, readonly code: "BUSY" | "CONFLICT" | "NOT_FOUND" | "INVALID" | "UNCERTAIN", readonly retryable = false) {
    super(message);
  }
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CollaborationError("Offsets must be nonnegative UTF-16 integers.", "INVALID");
  return value as number;
}
function body(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 20_000) throw new CollaborationError("Thread message body must contain 1–20,000 characters.", "INVALID");
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 100) throw new CollaborationError(`Invalid ${label}.`, "INVALID");
  return value;
}

export function parseApplyEnvelope(value: unknown): ApplyEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollaborationError("Apply input must be a JSON object.", "INVALID");
  const operations = (value as { operations?: unknown }).operations;
  if (!Array.isArray(operations) || operations.length !== 1) throw new CollaborationError("This version accepts exactly one operation.", "INVALID");
  const candidate = operations[0];
  if (!candidate || typeof candidate !== "object") throw new CollaborationError("Invalid operation.", "INVALID");
  const operation = candidate as Record<string, unknown>;
  const kind = operation.kind;
  if (kind === "replace") {
    const from = integer(operation.from), to = integer(operation.to);
    if (typeof operation.text !== "string" || operation.text.includes("\r") || operation.text.length > FOUNDATION_REPLACE_CHARACTERS) {
      throw new CollaborationError(`Invalid replacement text; this version accepts up to ${FOUNDATION_REPLACE_CHARACTERS.toLocaleString("en-US")} logical-LF characters.`, "INVALID");
    }
    return { operations: [{ kind, from, to, text: operation.text }] };
  }
  if (kind === "thread-add") return { operations: [{ kind, from: integer(operation.from), to: integer(operation.to), body: body(operation.body) }] };
  if (kind === "thread-reply") return { operations: [{ kind, threadId: identifier(operation.threadId, "thread ID"), body: body(operation.body) }] };
  if (kind === "thread-message-update") return { operations: [{ kind, threadId: identifier(operation.threadId, "thread ID"), messageId: identifier(operation.messageId, "message ID"), body: body(operation.body) }] };
  if (kind === "thread-message-delete") return { operations: [{ kind, threadId: identifier(operation.threadId, "thread ID"), messageId: identifier(operation.messageId, "message ID") }] };
  if (kind === "thread-resolve" || kind === "thread-reopen" || kind === "thread-delete") {
    return { operations: [{ kind, threadId: identifier(operation.threadId, "thread ID") }] };
  }
  throw new CollaborationError("Unknown collaboration operation.", "INVALID");
}

function splitSurrogate(text: string, offset: number): boolean {
  return offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
}

function semanticValue(thread: ReviewThread) {
  return {
    id: thread.id,
    state: thread.state,
    resolvedAt: thread.resolvedAt ?? null,
    resolvedBy: thread.resolvedBy ?? null,
    messages: thread.messages.map((message) => ({
      id: message.id, body: message.body, createdAt: message.createdAt, author: message.author ?? null,
      updatedAt: message.updatedAt ?? null, updatedBy: message.updatedBy ?? null,
    })),
  };
}

export function threadSemanticValue(thread: ReviewThread): string { return JSON.stringify(semanticValue(thread)); }

export async function threadRevision(thread: ReviewThread): Promise<string> {
  const bytes = new TextEncoder().encode(threadSemanticValue(thread));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `st1.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Evaluate the same guarded operation before either a disk save or editor dispatch. */
export async function evaluateApply(draft: Draft, envelopeValue: unknown, guards: ApplyGuards): Promise<{ draft: Draft; change: AppliedChange | null }> {
  validateDraft(draft);
  if (!guards.actor.trim() || guards.actor.length > 200) throw new CollaborationError("Actor must contain 1–200 characters.", "INVALID");
  const envelope = parseApplyEnvelope(envelopeValue);
  const operation = envelope.operations[0];
  const needsGlobal = operation.kind === "replace" || operation.kind === "thread-add";
  if (needsGlobal && guards.ifThreadRevision !== undefined) {
    throw new CollaborationError("This operation does not accept a thread revision guard.", "INVALID");
  }
  if ((needsGlobal && !guards.ifRevision) || guards.ifRevision !== undefined && guards.ifRevision !== guards.currentRevision) {
    throw new CollaborationError("Revision conflict: reread the document before applying.", "CONFLICT");
  }
  const next = structuredClone(draft);
  if (operation.kind === "replace") {
    if (operation.to < operation.from || operation.to > draft.text.length || splitSurrogate(draft.text, operation.from) || splitSurrogate(draft.text, operation.to)) {
      throw new CollaborationError("The replacement range is outside the document or splits a Unicode character.", "INVALID");
    }
    const text = draft.text.slice(0, operation.from) + operation.text + draft.text.slice(operation.to);
    const delta = operation.text.length - (operation.to - operation.from);
    next.threads = next.threads.map((thread) => {
      const anchor = thread.anchor;
      if (anchor.state === "orphaned") return thread;
      if ((operation.from < anchor.to && operation.to > anchor.from) || (operation.from === operation.to && operation.from > anchor.from && operation.from < anchor.to)) {
        return { ...thread, anchor: { ...anchor, state: "orphaned" as const } };
      }
      const from = anchor.from + (operation.to <= anchor.from ? delta : 0);
      const to = anchor.to + (operation.to < anchor.to || operation.to === anchor.to && operation.from < operation.to ? delta : 0);
      return { ...thread, anchor: makeAnchor(text, from, to) };
    });
    next.text = text;
    validateDraft(next);
    return { draft: next, change: { from: operation.from, to: operation.to, inserted: operation.text.length } };
  }
  const now = new Date().toISOString();
  if (operation.kind === "thread-add") {
    if (next.threads.length >= MAX_COMMENTS) throw new CollaborationError("A document can contain at most 1,000 review threads.", "INVALID");
    if (operation.to <= operation.from || operation.to > next.text.length || operation.to - operation.from > 8192 ||
      splitSurrogate(next.text, operation.from) || splitSurrogate(next.text, operation.to)) {
      throw new CollaborationError("Select between 1 and 8,192 complete UTF-16 characters for a review thread.", "INVALID");
    }
    const id = crypto.randomUUID();
    next.threads.push({ id, anchor: makeAnchor(next.text, operation.from, operation.to), state: "open", messages: [{ id, body: operation.body, createdAt: now, author: guards.actor }] });
  } else {
    const index = next.threads.findIndex((thread) => thread.id === operation.threadId);
    if (index < 0) throw new CollaborationError("Thread ID was not found.", "NOT_FOUND");
    const thread = next.threads[index]!;
    if (!guards.ifThreadRevision || guards.ifThreadRevision !== await threadRevision(thread)) {
      throw new CollaborationError("Thread conflict: reread this thread before applying.", "CONFLICT");
    }
    if (operation.kind === "thread-delete") next.threads.splice(index, 1);
    else if (operation.kind === "thread-reply") {
      if (thread.messages.length >= MAX_COMMENTS) throw new CollaborationError("A review thread can contain at most 1,000 messages.", "INVALID");
      thread.messages.push({ id: crypto.randomUUID(), body: operation.body, createdAt: now, author: guards.actor });
    } else if (operation.kind === "thread-message-update") {
      const message = thread.messages.find((item) => item.id === operation.messageId);
      if (!message) throw new CollaborationError("Message ID was not found in this thread.", "NOT_FOUND");
      message.body = operation.body; message.updatedAt = now; message.updatedBy = guards.actor;
    } else if (operation.kind === "thread-message-delete") {
      if (operation.messageId === thread.id) throw new CollaborationError("Delete the thread explicitly rather than deleting its root message.", "INVALID");
      const messageIndex = thread.messages.findIndex((item) => item.id === operation.messageId);
      if (messageIndex < 0) throw new CollaborationError("Message ID was not found in this thread.", "NOT_FOUND");
      thread.messages.splice(messageIndex, 1);
    } else if (operation.kind === "thread-resolve") {
      if (thread.state === "resolved") throw new CollaborationError("Thread is already resolved.", "INVALID");
      thread.state = "resolved"; thread.resolvedAt = now; thread.resolvedBy = guards.actor;
    } else {
      if (thread.state === "open") throw new CollaborationError("Thread is already open.", "INVALID");
      thread.state = "open"; delete thread.resolvedAt; delete thread.resolvedBy;
    }
  }
  validateDraft(next);
  return { draft: next, change: null };
}

export function liveRevision(instanceId: string, documentId: string, generation: number): string {
  return `sl1.${instanceId}.${documentId}.${generation}`;
}

export function isLiveRevision(value: string): boolean {
  return /^sl1\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[0-9]+$/.test(value);
}
