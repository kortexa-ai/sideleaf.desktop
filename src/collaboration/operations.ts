import { makeAnchor } from "../document/anchors.ts";
import { MAX_COMMENTS, MAX_REPLACEMENT_CHARACTERS, validateDraft, type CollaborationTarget, type Draft, type ReviewThread } from "../shared/contracts.ts";

export const COLLABORATION_CONTRACT = "sideleaf-collaboration/v1" as const;
export const APPLY_CONTRACT = "sideleaf-apply/v1" as const;
export const FOCUS_CONTRACT = "sideleaf-focus/v1" as const;
export const FOUNDATION_REPLACE_CHARACTERS = MAX_REPLACEMENT_CHARACTERS;
export const MAX_APPLY_OPERATIONS = 64;

export type DocumentTarget = CollaborationTarget;
export type PassageTarget = { quote: string; prefix?: string; suffix?: string };
export type ReplaceOperation = { kind: "replace"; from: number; to: number; text: string };
export type QuoteReplaceOperation = { kind: "replace-quote"; target: PassageTarget; text: string };
export type ThreadOperation =
  | { kind: "thread-add"; from: number; to: number; body: string }
  | { kind: "thread-add-quote"; target: PassageTarget; body: string }
  | { kind: "thread-reply"; threadId: string; body: string; ifThreadRevision?: string }
  | { kind: "thread-message-update"; threadId: string; messageId: string; body: string; ifThreadRevision?: string }
  | { kind: "thread-message-delete"; threadId: string; messageId: string; ifThreadRevision?: string }
  | { kind: "thread-resolve" | "thread-reopen" | "thread-delete"; threadId: string; ifThreadRevision?: string };
export type SuggestionOperation =
  | { kind: "suggestion-add"; target: PassageTarget; replacement: string; body: string }
  | { kind: "suggestion-accept" | "suggestion-reject"; threadId: string; ifThreadRevision?: string };
export type ApplyOperation = ReplaceOperation | QuoteReplaceOperation | ThreadOperation | SuggestionOperation;
export type ApplyEnvelope = { contract?: typeof APPLY_CONTRACT; ifRevision?: string; operations: ApplyOperation[] };
export type AppliedChange = { operation: number; from: number; to: number; inserted: number };
export type AppliedEdit = { operation: number; from: number; to: number; text: string };
export type ApplySummary = {
  changes: AppliedChange[];
  edits: AppliedEdit[];
  created: { threadIds: string[]; messageIds: string[] };
  changed: { threadIds: string[]; messageIds: string[] };
  activities: { operation: number; kind: ApplyOperation["kind"]; threadId?: string; messageId?: string; body?: string }[];
};
export type ApplyGuards = { actor: string; currentRevision: string; ifRevision?: string; ifThreadRevision?: string };

export function requiresDocumentRevision(envelope: ApplyEnvelope): boolean {
  return envelope.operations.some((operation) => operation.kind === "replace" || operation.kind === "thread-add");
}

export type FocusRequest =
  | { contract: typeof FOCUS_CONTRACT; kind: "range"; from: number; to: number }
  | { contract: typeof FOCUS_CONTRACT; kind: "passage"; target: PassageTarget; before: number; after: number }
  | { contract: typeof FOCUS_CONTRACT; kind: "thread"; threadId: string };
export type TextFocus = { kind: "range"; range: { from: number; to: number }; text: string }
  | { kind: "passage"; range: { from: number; to: number }; target: { from: number; to: number }; text: string };

export class CollaborationError extends Error {
  constructor(message: string, readonly code: "BUSY" | "CONFLICT" | "NOT_FOUND" | "INVALID" | "UNCERTAIN", readonly retryable = false) {
    super(message);
  }
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CollaborationError("Offsets must be nonnegative UTF-16 integers.", "INVALID");
  return value as number;
}
function boundedInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = integer(value);
  if (parsed > maximum) throw new CollaborationError(`${label} must be at most ${maximum.toLocaleString("en-US")} characters.`, "INVALID");
  return parsed;
}
function body(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 20_000) throw new CollaborationError("Thread message body must contain 1–20,000 characters.", "INVALID");
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 100) throw new CollaborationError(`Invalid ${label}.`, "INVALID");
  return value;
}
function revision(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 200) throw new CollaborationError(`Invalid ${label}.`, "INVALID");
  return value;
}
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function replacementText(value: unknown): string {
  if (typeof value !== "string" || value.includes("\r") || value.length > FOUNDATION_REPLACE_CHARACTERS || !wellFormed(value)) {
    throw new CollaborationError(`Invalid replacement text; use logical LF and at most ${FOUNDATION_REPLACE_CHARACTERS.toLocaleString("en-US")} complete UTF-16 characters.`, "INVALID");
  }
  return value;
}
function passageTarget(value: unknown): PassageTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollaborationError("Passage target must be an object.", "INVALID");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.quote !== "string" || !candidate.quote.length || candidate.quote.length > 8192 || candidate.quote.includes("\r") || !wellFormed(candidate.quote)) {
    throw new CollaborationError("Passage quote must contain 1–8,192 complete logical-LF UTF-16 characters.", "INVALID");
  }
  const context = (part: "prefix" | "suffix") => {
    const text = candidate[part];
    if (text === undefined) return undefined;
    if (typeof text !== "string" || text.length > 256 || text.includes("\r") || !wellFormed(text)) {
      throw new CollaborationError(`Passage ${part} must contain at most 256 complete logical-LF UTF-16 characters.`, "INVALID");
    }
    return text;
  };
  const prefix = context("prefix"), suffix = context("suffix");
  return { quote: candidate.quote, ...(prefix === undefined ? {} : { prefix }), ...(suffix === undefined ? {} : { suffix }) };
}

function parseOperation(candidate: unknown): ApplyOperation {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new CollaborationError("Invalid operation.", "INVALID");
  const operation = candidate as Record<string, unknown>, kind = operation.kind;
  if (["replace", "replace-quote", "thread-add", "thread-add-quote", "suggestion-add"].includes(kind as string) && operation.ifThreadRevision !== undefined) {
    throw new CollaborationError("This operation does not accept a thread revision guard.", "INVALID");
  }
  if (kind === "replace") return { kind, from: integer(operation.from), to: integer(operation.to), text: replacementText(operation.text) };
  if (kind === "replace-quote") return { kind, target: passageTarget(operation.target), text: replacementText(operation.text) };
  if (kind === "thread-add") return { kind, from: integer(operation.from), to: integer(operation.to), body: body(operation.body) };
  if (kind === "thread-add-quote") return { kind, target: passageTarget(operation.target), body: body(operation.body) };
  if (kind === "suggestion-add") return { kind, target: passageTarget(operation.target), replacement: replacementText(operation.replacement), body: body(operation.body) };
  const ifThreadRevision = revision(operation.ifThreadRevision, "thread revision");
  if (kind === "thread-reply") return { kind, threadId: identifier(operation.threadId, "thread ID"), body: body(operation.body), ...(ifThreadRevision ? { ifThreadRevision } : {}) };
  if (kind === "thread-message-update") return { kind, threadId: identifier(operation.threadId, "thread ID"), messageId: identifier(operation.messageId, "message ID"), body: body(operation.body), ...(ifThreadRevision ? { ifThreadRevision } : {}) };
  if (kind === "thread-message-delete") return { kind, threadId: identifier(operation.threadId, "thread ID"), messageId: identifier(operation.messageId, "message ID"), ...(ifThreadRevision ? { ifThreadRevision } : {}) };
  if (kind === "thread-resolve" || kind === "thread-reopen" || kind === "thread-delete") return { kind, threadId: identifier(operation.threadId, "thread ID"), ...(ifThreadRevision ? { ifThreadRevision } : {}) };
  if (kind === "suggestion-accept" || kind === "suggestion-reject") return { kind, threadId: identifier(operation.threadId, "thread ID"), ...(ifThreadRevision ? { ifThreadRevision } : {}) };
  throw new CollaborationError("Unknown collaboration operation.", "INVALID");
}

export function parseApplyEnvelope(value: unknown): ApplyEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollaborationError("Apply input must be a JSON object.", "INVALID");
  const candidate = value as Record<string, unknown>;
  if (candidate.contract !== undefined && candidate.contract !== APPLY_CONTRACT) throw new CollaborationError("Unsupported apply contract.", "INVALID");
  if (!Array.isArray(candidate.operations) || candidate.operations.length < 1 || candidate.operations.length > MAX_APPLY_OPERATIONS) throw new CollaborationError(`Apply input must contain 1–${MAX_APPLY_OPERATIONS} operations.`, "INVALID");
  return { ...(candidate.contract === APPLY_CONTRACT ? { contract: APPLY_CONTRACT } : {}),
    ...(candidate.ifRevision === undefined ? {} : { ifRevision: revision(candidate.ifRevision, "document revision")! }), operations: candidate.operations.map(parseOperation) };
}

export function parseFocusRequest(value: unknown): FocusRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollaborationError("Focus input must be a JSON object.", "INVALID");
  const request = value as Record<string, unknown>;
  if (request.contract !== FOCUS_CONTRACT) throw new CollaborationError("Unsupported focus contract.", "INVALID");
  if (request.kind === "range") return { contract: FOCUS_CONTRACT, kind: "range", from: integer(request.from), to: integer(request.to) };
  if (request.kind === "passage") return { contract: FOCUS_CONTRACT, kind: "passage", target: passageTarget(request.target),
    before: boundedInteger(request.before, 160, 4096, "Passage context before"), after: boundedInteger(request.after, 160, 4096, "Passage context after") };
  if (request.kind === "thread") return { contract: FOCUS_CONTRACT, kind: "thread", threadId: identifier(request.threadId, "thread ID") };
  throw new CollaborationError("Unknown focus request.", "INVALID");
}

function splitSurrogate(text: string, offset: number): boolean {
  return offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!);
}

export function resolvePassage(text: string, target: PassageTarget): { from: number; to: number } {
  const matches: number[] = [];
  for (let from = text.indexOf(target.quote); from >= 0; from = text.indexOf(target.quote, from + 1)) {
    const to = from + target.quote.length;
    if (target.prefix !== undefined && text.slice(Math.max(0, from - target.prefix.length), from) !== target.prefix) continue;
    if (target.suffix !== undefined && text.slice(to, to + target.suffix.length) !== target.suffix) continue;
    matches.push(from);
    if (matches.length > 1) break;
  }
  if (!matches.length) throw new CollaborationError("The passage was not found. Reread the document before applying.", "CONFLICT");
  if (matches.length > 1) throw new CollaborationError("The passage is ambiguous. Add exact prefix or suffix context.", "CONFLICT");
  const from = matches[0]!, to = from + target.quote.length;
  if (splitSurrogate(text, from) || splitSurrogate(text, to)) throw new CollaborationError("The passage target splits a Unicode character.", "INVALID");
  return { from, to };
}

export function focusDraft(draft: Draft, requestValue: unknown): TextFocus | { kind: "thread"; thread: ReviewThread } {
  validateDraft(draft);
  const request = parseFocusRequest(requestValue);
  if (request.kind === "thread") {
    const thread = draft.threads.find((candidate) => candidate.id === request.threadId);
    if (!thread) throw new CollaborationError("Thread ID was not found.", "NOT_FOUND");
    return { kind: "thread", thread: structuredClone(thread) };
  }
  if (request.kind === "range") {
    if (request.to < request.from || request.to > draft.text.length || request.to - request.from > 16_384 || splitSurrogate(draft.text, request.from) || splitSurrogate(draft.text, request.to)) throw new CollaborationError("Focused range must contain at most 16,384 complete UTF-16 characters inside the document.", "INVALID");
    return { kind: "range", range: { from: request.from, to: request.to }, text: draft.text.slice(request.from, request.to) };
  }
  const target = resolvePassage(draft.text, request.target);
  let from = Math.max(0, target.from - request.before), to = Math.min(draft.text.length, target.to + request.after);
  if (to - from > 16_384) to = from + 16_384;
  if (splitSurrogate(draft.text, from)) from++;
  if (splitSurrogate(draft.text, to)) to--;
  return { kind: "passage", range: { from, to }, target, text: draft.text.slice(from, to) };
}

function semanticValue(thread: ReviewThread) {
  return { id: thread.id, state: thread.state, resolvedAt: thread.resolvedAt ?? null, resolvedBy: thread.resolvedBy ?? null,
    messages: thread.messages.map((message) => ({ id: message.id, body: message.body, createdAt: message.createdAt, author: message.author ?? null,
      updatedAt: message.updatedAt ?? null, updatedBy: message.updatedBy ?? null })), suggestion: thread.suggestion ? {
      version: thread.suggestion.version, state: thread.suggestion.state, original: thread.suggestion.original,
      replacement: thread.suggestion.replacement, prefix: thread.suggestion.prefix ?? null, suffix: thread.suggestion.suffix ?? null,
      decidedAt: thread.suggestion.decidedAt ?? null, decidedBy: thread.suggestion.decidedBy ?? null,
    } : null };
}
export function threadSemanticValue(thread: ReviewThread): string { return JSON.stringify(semanticValue(thread)); }
export async function threadRevision(thread: ReviewThread): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(threadSemanticValue(thread)));
  return `st1.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function addUnique(target: string[], value: string) { if (!target.includes(value)) target.push(value); }

function applyTextReplacement(draft: Draft, from: number, to: number, replacement: string) {
  const text = draft.text.slice(0, from) + replacement + draft.text.slice(to);
  const delta = replacement.length - (to - from);
  draft.threads = draft.threads.map((thread) => {
    const anchor = thread.anchor;
    if (anchor.state === "orphaned") return thread;
    if ((from < anchor.to && to > anchor.from) || (from === to && from > anchor.from && from < anchor.to)) {
      return { ...thread, anchor: { ...anchor, state: "orphaned" as const } };
    }
    const nextFrom = anchor.from + (to <= anchor.from ? delta : 0);
    const nextTo = anchor.to + (to < anchor.to || to === anchor.to && from < to ? delta : 0);
    return { ...thread, anchor: makeAnchor(text, nextFrom, nextTo) };
  });
  draft.text = text;
}

/** Evaluate the same guarded batch before either a disk save or editor dispatch. */
export async function evaluateApply(draft: Draft, envelopeValue: unknown, guards: ApplyGuards): Promise<{ draft: Draft; change: AppliedChange | null; summary: ApplySummary }> {
  validateDraft(draft);
  if (!guards.actor.trim() || guards.actor.length > 200) throw new CollaborationError("Actor must contain 1–200 characters.", "INVALID");
  const envelope = parseApplyEnvelope(envelopeValue);
  if (envelope.ifRevision && guards.ifRevision && envelope.ifRevision !== guards.ifRevision) throw new CollaborationError("Conflicting document revision guards.", "INVALID");
  const ifRevision = envelope.ifRevision ?? guards.ifRevision;
  const offsetOperation = requiresDocumentRevision(envelope);
  if ((offsetOperation && !ifRevision) || ifRevision !== undefined && ifRevision !== guards.currentRevision) throw new CollaborationError("Revision conflict: reread the document before applying.", "CONFLICT");
  if (guards.ifThreadRevision !== undefined) {
    if (envelope.operations.length !== 1) throw new CollaborationError("A batch carries thread revision guards on its operations.", "INVALID");
    const operation = envelope.operations[0]!;
    if (!("threadId" in operation)) throw new CollaborationError("This operation does not accept a thread revision guard.", "INVALID");
    if (operation.ifThreadRevision !== undefined && operation.ifThreadRevision !== guards.ifThreadRevision) throw new CollaborationError("Conflicting thread revision guards.", "INVALID");
  }
  const originalThreads = new Map(draft.threads.map((thread) => [thread.id, thread]));
  const checkedThreads = new Map<string, string>();
  const next = structuredClone(draft);
  const summary: ApplySummary = { changes: [], edits: [], created: { threadIds: [], messageIds: [] }, changed: { threadIds: [], messageIds: [] }, activities: [] };

  for (const [operationIndex, originalOperation] of envelope.operations.entries()) {
    let operation = originalOperation;
    if (operation.kind === "replace-quote") operation = { kind: "replace", ...resolvePassage(next.text, operation.target), text: operation.text };
    else if (operation.kind === "thread-add-quote") operation = { kind: "thread-add", ...resolvePassage(next.text, operation.target), body: operation.body };
    if (operation.kind === "replace") {
      if (operation.to < operation.from || operation.to > next.text.length || splitSurrogate(next.text, operation.from) || splitSurrogate(next.text, operation.to)) throw new CollaborationError("The replacement range is outside the document or splits a Unicode character.", "INVALID");
      applyTextReplacement(next, operation.from, operation.to, operation.text);
      summary.changes.push({ operation: operationIndex, from: operation.from, to: operation.to, inserted: operation.text.length });
      summary.edits.push({ operation: operationIndex, from: operation.from, to: operation.to, text: operation.text });
      summary.activities.push({ operation: operationIndex, kind: originalOperation.kind });
      continue;
    }
    const now = new Date().toISOString();
    if (operation.kind === "thread-add") {
      if (next.threads.length >= MAX_COMMENTS) throw new CollaborationError("A document can contain at most 1,000 review threads.", "INVALID");
      if (operation.to <= operation.from || operation.to > next.text.length || operation.to - operation.from > 8192 || splitSurrogate(next.text, operation.from) || splitSurrogate(next.text, operation.to)) throw new CollaborationError("Select between 1 and 8,192 complete UTF-16 characters for a review thread.", "INVALID");
      const id = crypto.randomUUID();
      next.threads.push({ id, anchor: makeAnchor(next.text, operation.from, operation.to), state: "open", messages: [{ id, body: operation.body, createdAt: now, author: guards.actor }] });
      summary.created.threadIds.push(id); summary.created.messageIds.push(id);
      summary.activities.push({ operation: operationIndex, kind: originalOperation.kind, threadId: id, messageId: id, body: operation.body }); continue;
    }
    if (operation.kind === "suggestion-add") {
      if (next.threads.length >= MAX_COMMENTS) throw new CollaborationError("A document can contain at most 1,000 review threads.", "INVALID");
      const target = resolvePassage(next.text, operation.target), id = crypto.randomUUID();
      next.threads.push({ id, anchor: makeAnchor(next.text, target.from, target.to), state: "open",
        messages: [{ id, body: operation.body, createdAt: now, author: guards.actor }], suggestion: {
          version: 1, state: "pending", original: operation.target.quote, replacement: operation.replacement,
          ...(operation.target.prefix === undefined ? {} : { prefix: operation.target.prefix }),
          ...(operation.target.suffix === undefined ? {} : { suffix: operation.target.suffix }),
        } });
      summary.created.threadIds.push(id); summary.created.messageIds.push(id);
      summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: id, messageId: id, body: operation.body }); continue;
    }
    const original = originalThreads.get(operation.threadId);
    if (!original) throw new CollaborationError("Thread ID was not found.", "NOT_FOUND");
    const supplied = operation.ifThreadRevision ?? (envelope.operations.length === 1 ? guards.ifThreadRevision : undefined);
    const expected = checkedThreads.get(operation.threadId) ?? await threadRevision(original);
    if (!supplied || supplied !== expected) throw new CollaborationError("Thread conflict: reread this thread before applying.", "CONFLICT");
    checkedThreads.set(operation.threadId, expected);
    const index = next.threads.findIndex((thread) => thread.id === operation.threadId);
    if (index < 0) throw new CollaborationError("Thread ID was not found after an earlier batch operation.", "NOT_FOUND");
    const thread = next.threads[index]!; addUnique(summary.changed.threadIds, thread.id);
    if (operation.kind === "suggestion-accept" || operation.kind === "suggestion-reject") {
      const suggestion = thread.suggestion;
      if (!suggestion) throw new CollaborationError("This thread does not contain a suggestion.", "INVALID");
      if (suggestion.state !== "pending") throw new CollaborationError(`This suggestion is already ${suggestion.state}.`, "INVALID");
      if (operation.kind === "suggestion-accept") {
        if (thread.anchor.state !== "attached") throw new CollaborationError("The suggested passage is no longer attached. Review the source before accepting.", "CONFLICT");
        const target = resolvePassage(next.text, { quote: suggestion.original,
          ...(suggestion.prefix === undefined ? {} : { prefix: suggestion.prefix }),
          ...(suggestion.suffix === undefined ? {} : { suffix: suggestion.suffix }) });
        if (target.from !== thread.anchor.from || target.to !== thread.anchor.to || next.text.slice(target.from, target.to) !== suggestion.original) {
          throw new CollaborationError("The suggested passage no longer matches its anchored source. Review the source before accepting.", "CONFLICT");
        }
        suggestion.state = "accepted"; suggestion.decidedAt = now; suggestion.decidedBy = guards.actor;
        applyTextReplacement(next, target.from, target.to, suggestion.replacement);
        summary.changes.push({ operation: operationIndex, from: target.from, to: target.to, inserted: suggestion.replacement.length });
        summary.edits.push({ operation: operationIndex, from: target.from, to: target.to, text: suggestion.replacement });
      } else {
        suggestion.state = "rejected"; suggestion.decidedAt = now; suggestion.decidedBy = guards.actor;
      }
      summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: thread.id, messageId: thread.messages[0]!.id, body: thread.messages[0]!.body });
    }
    else if (operation.kind === "thread-delete") { next.threads.splice(index, 1); summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: thread.id }); }
    else if (operation.kind === "thread-reply") {
      if (thread.messages.length >= MAX_COMMENTS) throw new CollaborationError("A review thread can contain at most 1,000 messages.", "INVALID");
      const id = crypto.randomUUID(); thread.messages.push({ id, body: operation.body, createdAt: now, author: guards.actor }); summary.created.messageIds.push(id);
      summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: thread.id, messageId: id, body: operation.body });
    } else if (operation.kind === "thread-message-update") {
      const message = thread.messages.find((item) => item.id === operation.messageId);
      if (!message) throw new CollaborationError("Message ID was not found in this thread.", "NOT_FOUND");
      message.body = operation.body; message.updatedAt = now; message.updatedBy = guards.actor; addUnique(summary.changed.messageIds, message.id);
      summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: thread.id, messageId: message.id, body: operation.body });
    } else if (operation.kind === "thread-message-delete") {
      if (operation.messageId === thread.id) throw new CollaborationError("Delete the thread explicitly rather than deleting its root message.", "INVALID");
      const messageIndex = thread.messages.findIndex((item) => item.id === operation.messageId);
      if (messageIndex < 0) throw new CollaborationError("Message ID was not found in this thread.", "NOT_FOUND");
      addUnique(summary.changed.messageIds, operation.messageId); thread.messages.splice(messageIndex, 1);
      summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: thread.id, messageId: operation.messageId });
    } else if (operation.kind === "thread-resolve") {
      if (thread.state === "resolved") throw new CollaborationError("Thread is already resolved.", "INVALID");
      thread.state = "resolved"; thread.resolvedAt = now; thread.resolvedBy = guards.actor;
      summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: thread.id });
    } else {
      if (thread.state === "open") throw new CollaborationError("Thread is already open.", "INVALID");
      thread.state = "open"; delete thread.resolvedAt; delete thread.resolvedBy;
      summary.activities.push({ operation: operationIndex, kind: operation.kind, threadId: thread.id });
    }
  }
  validateDraft(next);
  return { draft: next, change: summary.changes.length === 1 ? summary.changes[0]! : null, summary };
}

export function liveRevision(instanceId: string, documentId: string, generation: number): string { return `sl1.${instanceId}.${documentId}.${generation}`; }
export function isLiveRevision(value: string): boolean { return /^sl1\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[0-9]+$/.test(value); }
