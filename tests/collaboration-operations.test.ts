import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { CollaborationError, evaluateApply, liveRevision, parseApplyEnvelope, threadRevision } from "../src/collaboration/operations.ts";

const reviewThread = (text: string) => ({ id: "c", state: "open" as const, anchor: makeAnchor(text, 13, 15), messages: [{ id: "c", body: "leaf", createdAt: "today" }] });

test("one guarded replacement evaluates identically and remains one editor undo step", async () => {
  const instance = crypto.randomUUID(), document = crypto.randomUUID();
  let state = EditorState.create({ doc: "Before Hello 🌿 world", extensions: [history(), commentField, commentHistory] });
  const thread = reviewThread(state.doc.toString());
  state = state.update({ effects: setComments.of([thread]), annotations: isolateHistory.of("full") }).state;
  const revision = liveRevision(instance, document, 0);
  const envelope = parseApplyEnvelope({ operations: [{ kind: "replace", from: 0, to: 0, text: "Agent " }] });
  const evaluated = await evaluateApply({ text: state.doc.toString(), threads: state.field(commentField) }, envelope, { actor: "agent:test", currentRevision: revision, ifRevision: revision });
  const operation = envelope.operations[0]; assert.equal(operation.kind, "replace");
  state = state.update({ selection: { anchor: 13, head: 15 } }).state;
  state = state.update({ changes: { from: operation.from, to: operation.to, insert: operation.text }, effects: setComments.of(evaluated.draft.threads), annotations: isolateHistory.of("full") }).state;
  assert.equal(state.doc.toString(), "Agent Before Hello 🌿 world");
  assert.deepEqual({ anchor: state.selection.main.anchor, head: state.selection.main.head }, { anchor: 19, head: 21 });
  assert.equal(state.field(commentField)[0]!.anchor.from, 19);
  const target = { get state() { return state; }, dispatch: (transaction: Transaction) => { state = transaction.state; } };
  assert.equal(undo(target), true); assert.equal(state.doc.toString(), "Before Hello 🌿 world"); assert.deepEqual(state.field(commentField), [thread]);
});

test("thread semantic guards ignore anchors and reject changed messages", async () => {
  const text = "Before Hello 🌿 world", thread = reviewThread(text), semantic = await threadRevision(thread);
  const shifted = { ...thread, anchor: makeAnchor(`Agent ${text}`, 19, 21) };
  assert.equal(await threadRevision(shifted), semantic);
  const replied = await evaluateApply({ text, threads: [thread] }, { operations: [{ kind: "thread-reply", threadId: "c", body: "Reply" }] },
    { actor: "agent:test", currentRevision: "new-global", ifThreadRevision: semantic });
  assert.equal(replied.draft.threads[0]!.messages[1]!.author, "agent:test");
  await assert.rejects(() => evaluateApply(replied.draft, { operations: [{ kind: "thread-resolve", threadId: "c" }] },
    { actor: "agent:test", currentRevision: "newer", ifThreadRevision: semantic }), (error: CollaborationError) => error.code === "CONFLICT");
});

test("thread operations preserve resolved state and root deletion is explicit", async () => {
  const text = "Before Hello 🌿 world", thread = reviewThread(text);
  const resolved = await evaluateApply({ text, threads: [thread] }, { operations: [{ kind: "thread-resolve", threadId: "c" }] },
    { actor: "human", currentRevision: "g", ifThreadRevision: await threadRevision(thread) });
  const resolvedThread = resolved.draft.threads[0]!;
  const reply = await evaluateApply(resolved.draft, { operations: [{ kind: "thread-reply", threadId: "c", body: "After resolve" }] },
    { actor: "agent", currentRevision: "g2", ifThreadRevision: await threadRevision(resolvedThread) });
  assert.equal(reply.draft.threads[0]!.state, "resolved");
  const replyRevision = await threadRevision(reply.draft.threads[0]!);
  await assert.rejects(() => evaluateApply(reply.draft, { operations: [{ kind: "thread-message-delete", threadId: "c", messageId: "c" }] },
    { actor: "agent", currentRevision: "g", ifThreadRevision: replyRevision }), /root message/);
});

test("invalid and surrogate-splitting applies reject before mutation", async () => {
  const revision = liveRevision(crypto.randomUUID(), crypto.randomUUID(), 3), draft = { text: "A🌿B", threads: [] };
  await assert.rejects(() => evaluateApply(draft, { operations: [{ kind: "replace", from: 0, to: 1, text: "C" }] }, { actor: "a", currentRevision: revision, ifRevision: "stale" }),
    (error: CollaborationError) => error.code === "CONFLICT");
  await assert.rejects(() => evaluateApply(draft, { operations: [{ kind: "replace", from: 2, to: 2, text: "x" }] }, { actor: "a", currentRevision: revision, ifRevision: revision }), /splits a Unicode/);
  assert.throws(() => parseApplyEnvelope({ operations: [] }), /exactly one/);
});

test("thread add rejects invalid anchors, capacity, and inapplicable guards as input errors", async () => {
  const text = "A🌿B", revision = "current";
  for (const [from, to] of [[1, 2], [2, 3], [3, 3], [0, 99]]) {
    await assert.rejects(() => evaluateApply({ text, threads: [] }, { operations: [{ kind: "thread-add", from, to, body: "Review" }] },
      { actor: "agent", currentRevision: revision, ifRevision: revision }), (error: CollaborationError) => error.code === "INVALID");
  }
  await assert.rejects(() => evaluateApply({ text, threads: [] }, { operations: [{ kind: "replace", from: 0, to: 0, text: "x" }] },
    { actor: "agent", currentRevision: revision, ifRevision: revision, ifThreadRevision: `st1.${"0".repeat(64)}` }),
  (error: CollaborationError) => error.code === "INVALID");

  const threads = Array.from({ length: 1000 }, (_, index) => ({ id: `thread-${index}`, state: "open" as const,
    anchor: makeAnchor(text, 0, 1), messages: [{ id: `thread-${index}`, body: "Review", createdAt: "today" }] }));
  await assert.rejects(() => evaluateApply({ text, threads }, { operations: [{ kind: "thread-add", from: 0, to: 1, body: "One too many" }] },
    { actor: "agent", currentRevision: revision, ifRevision: revision }), (error: CollaborationError) => error.code === "INVALID");
});
