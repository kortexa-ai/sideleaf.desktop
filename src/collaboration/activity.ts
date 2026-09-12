export const LIVE_CURSOR_PREFIX = "sc1";
export const FILE_CURSOR_PREFIX = "sf1";
export const MAX_ACTIVITY_EVENTS = 256;

export type ActivityKind = "thread-created" | "thread-replied" | "message-edited" | "message-deleted"
  | "thread-resolved" | "thread-reopened" | "thread-deleted" | "source-applied";
export type ActivityEvent = {
  kind: ActivityKind;
  actor: string;
  threadId?: string;
  messageId?: string;
  body?: string;
  ranges?: { from: number; to: number }[];
  createdAt: string;
};
export type CursorActivity = ActivityEvent & { documentId: string; cursor: string };
export type ActivityFilter = { actor?: string; threadId?: string; mention?: string };
export type ActivityScan = { outcome: "event"; cursor: string; event: Omit<CursorActivity, "body"> & { preview?: string } }
  | { outcome: "resync"; cursor: string; reason: "gap" | "restart" | "legacy-cursor" | "document-closed" }
  | { outcome: "none"; cursor: string };

type ParsedCursor = { instanceId: string; documentId: string; sequence: number };

export function liveCursor(instanceId: string, documentId: string, sequence: number): string {
  return `${LIVE_CURSOR_PREFIX}.${instanceId}.${documentId}.${sequence}`;
}
export function fileCursor(revision: string): string { return `${FILE_CURSOR_PREFIX}.${revision}`; }
export function parseLiveCursor(value: string): ParsedCursor | null {
  const match = /^sc1\.([a-f0-9-]{36})\.([a-f0-9-]{36})\.([0-9]+)$/.exec(value);
  if (!match) return null;
  const sequence = Number(match[3]);
  return Number.isSafeInteger(sequence) ? { instanceId: match[1]!, documentId: match[2]!, sequence } : null;
}

export function matchesActivity(event: Pick<ActivityEvent, "actor" | "threadId" | "body">, filter: ActivityFilter): boolean {
  if (filter.actor && event.actor === filter.actor) return false;
  if (filter.threadId && event.threadId !== filter.threadId) return false;
  if (filter.mention && !event.body?.toLocaleLowerCase().includes(filter.mention.toLocaleLowerCase())) return false;
  return true;
}
export function publicActivity(event: CursorActivity): Omit<CursorActivity, "body"> & { preview?: string } {
  const { body, ...rest } = event;
  return { ...rest, ...(body ? { preview: body.slice(0, 240) } : {}) };
}

/** Bounded semantic activity owned by one app instance. The renderer records
 * before returning a commit receipt; the host may ingest the same cursor. */
export class ActivityJournal {
  private readonly sequences = new Map<string, number>();
  private readonly events = new Map<string, CursorActivity[]>();
  private readonly listeners = new Set<() => void>();
  constructor(readonly instanceId: string) {}
  cursor(documentId: string): string { return liveCursor(this.instanceId, documentId, this.sequences.get(documentId) ?? 0); }
  record(documentId: string, event: Omit<ActivityEvent, "createdAt"> & { createdAt?: string }): CursorActivity {
    const sequence = (this.sequences.get(documentId) ?? 0) + 1;
    this.sequences.set(documentId, sequence);
    const record: CursorActivity = { ...event, createdAt: event.createdAt ?? new Date().toISOString(), documentId, cursor: liveCursor(this.instanceId, documentId, sequence) };
    const list = this.events.get(documentId) ?? [];
    list.push(record); while (list.length > MAX_ACTIVITY_EVENTS) list.shift();
    this.events.set(documentId, list); this.notify(); return record;
  }
  ingest(event: CursorActivity): boolean {
    const cursor = parseLiveCursor(event.cursor);
    if (!cursor || cursor.instanceId !== this.instanceId || cursor.documentId !== event.documentId) return false;
    const current = this.sequences.get(event.documentId) ?? 0;
    if (cursor.sequence <= current) {
      const list = this.events.get(event.documentId) ?? [];
      const existing = list.find((candidate) => parseLiveCursor(candidate.cursor)?.sequence === cursor.sequence);
      if (existing) return JSON.stringify(existing) === JSON.stringify(event);
      const earliest = parseLiveCursor(list[0]?.cursor ?? "")?.sequence;
      return earliest !== undefined && cursor.sequence < earliest;
    }
    this.sequences.set(event.documentId, cursor.sequence);
    const list = this.events.get(event.documentId) ?? [];
    list.push(structuredClone(event)); while (list.length > MAX_ACTIVITY_EVENTS) list.shift();
    this.events.set(event.documentId, list); this.notify(); return true;
  }
  scan(documentId: string, after: string, filter: ActivityFilter = {}): ActivityScan {
    const cursor = parseLiveCursor(after), current = this.cursor(documentId);
    if (!cursor) return { outcome: "resync", cursor: current, reason: "legacy-cursor" };
    if (cursor.instanceId !== this.instanceId) return { outcome: "resync", cursor: current, reason: "restart" };
    if (cursor.documentId !== documentId) return { outcome: "resync", cursor: current, reason: "gap" };
    const currentSequence = this.sequences.get(documentId) ?? 0;
    if (cursor.sequence > currentSequence) return { outcome: "resync", cursor: current, reason: "gap" };
    const list = this.events.get(documentId) ?? [], earliest = parseLiveCursor(list[0]?.cursor ?? current)?.sequence ?? 0;
    if (cursor.sequence < earliest - 1) return { outcome: "resync", cursor: current, reason: "gap" };
    let expected = cursor.sequence + 1;
    for (const event of list) {
      const sequence = parseLiveCursor(event.cursor)?.sequence ?? 0;
      if (sequence <= cursor.sequence) continue;
      if (sequence !== expected) return { outcome: "resync", cursor: current, reason: "gap" };
      if (matchesActivity(event, filter)) return { outcome: "event", cursor: event.cursor, event: publicActivity(event) };
      expected++;
    }
    return { outcome: "none", cursor: current };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  drop(documentId: string) { this.sequences.delete(documentId); this.events.delete(documentId); this.notify(); }
  private notify() { for (const listener of this.listeners) listener(); }
}

export function activityForOperation(kind: string, actor: string, ids: { threadId?: string; messageId?: string; body?: string }, ranges?: { from: number; to: number }[]): Omit<ActivityEvent, "createdAt"> {
  const mapped: Record<string, ActivityKind> = {
    "thread-add": "thread-created", "thread-add-quote": "thread-created", "thread-reply": "thread-replied",
    "thread-message-update": "message-edited", "thread-message-delete": "message-deleted",
    "thread-resolve": "thread-resolved", "thread-reopen": "thread-reopened", "thread-delete": "thread-deleted",
    replace: "source-applied", "replace-quote": "source-applied",
  };
  const visibleRanges = ranges?.filter(({ from, to }) => from < to);
  return { kind: mapped[kind]!, actor, ...ids, ...(visibleRanges?.length ? { ranges: visibleRanges } : {}) };
}

export function diffDraftActivity(before: import("../shared/contracts.ts").Draft, after: import("../shared/contracts.ts").Draft, fallbackActor: string): ActivityEvent[] {
  const events: ActivityEvent[] = [], now = new Date().toISOString();
  const prior = new Map(before.threads.map((thread) => [thread.id, thread]));
  const current = new Map(after.threads.map((thread) => [thread.id, thread]));
  for (const thread of after.threads) {
    const old = prior.get(thread.id);
    if (!old) {
      const root = thread.messages[0]!;
      events.push({ kind: "thread-created", actor: root.author ?? fallbackActor, threadId: thread.id, messageId: root.id, body: root.body, createdAt: root.createdAt });
      continue;
    }
    if (old.state !== thread.state) events.push({ kind: thread.state === "resolved" ? "thread-resolved" : "thread-reopened",
      actor: thread.resolvedBy ?? fallbackActor, threadId: thread.id, createdAt: thread.resolvedAt ?? now });
    const oldMessages = new Map(old.messages.map((message) => [message.id, message]));
    const newMessages = new Map(thread.messages.map((message) => [message.id, message]));
    for (const message of thread.messages) {
      const previous = oldMessages.get(message.id);
      if (!previous) events.push({ kind: "thread-replied", actor: message.author ?? fallbackActor, threadId: thread.id, messageId: message.id, body: message.body, createdAt: message.createdAt });
      else if (previous.body !== message.body || previous.updatedAt !== message.updatedAt || previous.updatedBy !== message.updatedBy) {
        events.push({ kind: "message-edited", actor: message.updatedBy ?? fallbackActor, threadId: thread.id, messageId: message.id, body: message.body, createdAt: message.updatedAt ?? now });
      }
    }
    for (const message of old.messages) if (!newMessages.has(message.id)) events.push({ kind: "message-deleted", actor: fallbackActor, threadId: thread.id, messageId: message.id, createdAt: now });
  }
  for (const thread of before.threads) if (!current.has(thread.id)) events.push({ kind: "thread-deleted", actor: fallbackActor, threadId: thread.id, createdAt: now });
  if (before.text !== after.text) events.push({ kind: "source-applied", actor: fallbackActor, createdAt: now });
  return events;
}
