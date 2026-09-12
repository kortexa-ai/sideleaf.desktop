import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { ActivityJournal, activityForOperation, diffDraftActivity, fileCursor, liveCursor } from "../src/collaboration/activity.ts";

const instance = "11111111-1111-4111-8111-111111111111", documentId = "22222222-2222-4222-8222-222222222222";

test("semantic cursors retain response-before-wait and filter without skipping later events", () => {
  const journal = new ActivityJournal(instance), start = journal.cursor(documentId);
  journal.record(documentId, { kind: "thread-replied", actor: "agent:self", threadId: "t", messageId: "m1", body: "@root own" });
  journal.record(documentId, { kind: "thread-replied", actor: "other", threadId: "t", messageId: "m2", body: "not mentioned" });
  const wanted = journal.record(documentId, { kind: "thread-replied", actor: "other", threadId: "t", messageId: "m3", body: "Hello @ROOT" });
  const scan = journal.scan(documentId, start, { actor: "agent:self", threadId: "t", mention: "@root" });
  assert.equal(scan.outcome, "event");
  if (scan.outcome === "event") { assert.equal(scan.cursor, wanted.cursor); assert.equal(scan.event.preview, "Hello @ROOT"); assert.equal("body" in scan.event, false); }
});

test("future, restart, legacy, retention and ingestion gaps request resync", () => {
  const journal = new ActivityJournal(instance), start = journal.cursor(documentId);
  assert.equal(journal.scan(documentId, liveCursor(instance, documentId, 8)).outcome, "resync");
  assert.equal(journal.scan(documentId, fileCursor("a".repeat(64))).outcome, "resync");
  assert.equal(journal.scan(documentId, `sc1.33333333-3333-4333-8333-333333333333.${documentId}.0`).outcome, "resync");
  const source = new ActivityJournal(instance);
  const one = source.record(documentId, { kind: "thread-created", actor: "human", threadId: "t", messageId: "t", body: "root" });
  source.record(documentId, { kind: "thread-replied", actor: "human", threadId: "t", messageId: "m", body: "reply" });
  const three = source.record(documentId, { kind: "thread-resolved", actor: "human", threadId: "t" });
  assert.equal(journal.ingest(one), true); assert.equal(journal.ingest(three), true);
  assert.equal(journal.scan(documentId, one.cursor).outcome, "resync");
  const five = { ...three, cursor: liveCursor(instance, documentId, 5) };
  assert.equal(journal.ingest(five), true); assert.equal(journal.scan(documentId, three.cursor).outcome, "resync");
  for (let index = 0; index < 260; index++) journal.record(documentId, { kind: "source-applied", actor: "a", ranges: [{ from: index, to: index + 1 }] });
  assert.equal(journal.scan(documentId, start).outcome, "resync");
});

test("closing a document drops its event state before the ID can be reused", () => {
  const journal = new ActivityJournal(instance); let notifications = 0;
  journal.subscribe(() => notifications++);
  journal.record(documentId, { kind: "source-applied", actor: "a" }); journal.drop(documentId);
  assert.equal(journal.cursor(documentId), liveCursor(instance, documentId, 0));
  assert.equal(notifications, 2, "drop must wake a pending waiter after ownership closes");
});

test("source activity omits final ranges erased or inverted by later batch edits", () => {
  assert.deepEqual(activityForOperation("replace", "agent", {}, [{ from: 7, to: 4 }, { from: 3, to: 3 }]),
    { kind: "source-applied", actor: "agent" });
  assert.deepEqual(activityForOperation("replace", "agent", {}, [{ from: 2, to: 5 }, { from: 9, to: 9 }]),
    { kind: "source-applied", actor: "agent", ranges: [{ from: 2, to: 5 }] });
});

test("duplicate deliveries are idempotent only when their retained payload is identical", () => {
  const source = new ActivityJournal(instance), sink = new ActivityJournal(instance);
  const event = source.record(documentId, { kind: "thread-created", actor: "human", threadId: "t", messageId: "t", body: "root" });
  assert.equal(sink.ingest(event), true); assert.equal(sink.ingest(structuredClone(event)), true);
  assert.equal(sink.ingest({ ...event, actor: "different" }), false);
});

test("one undo of a thread reply produces one local semantic deletion event", () => {
  const text = "Review this", root = { id: "t", state: "open" as const, anchor: makeAnchor(text, 0, 6), messages: [{ id: "t", body: "Root", createdAt: "today", author: "human" }] };
  let state = EditorState.create({ doc: text, extensions: [history(), commentField, commentHistory] });
  state = state.update({ effects: setComments.of([root]), annotations: isolateHistory.of("full") }).state;
  state = state.update({ effects: setComments.of([{ ...root, messages: [...root.messages, { id: "r", body: "Agent reply", createdAt: "later", author: "agent" }] }]), annotations: isolateHistory.of("full"), userEvent: "input.agent" }).state;
  const before = state.field(commentField);
  const target = { get state() { return state; }, dispatch: (transaction: Transaction) => { state = transaction.state; } };
  assert.equal(undo(target), true);
  const events = diffDraftActivity({ text, threads: before }, { text, threads: state.field(commentField) }, "local").map((event) => ({ ...event, actor: "local" }));
  assert.deepEqual(events.map(({ kind, actor, threadId, messageId }) => ({ kind, actor, threadId, messageId })),
    [{ kind: "message-deleted", actor: "local", threadId: "t", messageId: "r" }]);
});
