import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { CollaborationError, evaluateApply, focusDraft, liveRevision, parseApplyEnvelope, threadRevision } from "../src/collaboration/operations.ts";

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
  assert.throws(() => parseApplyEnvelope({ operations: [] }), /1–64/);
});

test("quote-addressed batches evaluate sequentially and share the batch-start thread guard", async () => {
  const text = "North: replace me. South: replace me. Tail 🌿", thread = { ...reviewThread(`Before ${text}`), anchor: makeAnchor(text, 0, 5) };
  const semantic = await threadRevision(thread), draft = { text, threads: [thread] };
  const result = await evaluateApply(draft, { contract: "sideleaf-apply/v1", operations: [
    { kind: "replace-quote", target: { quote: "replace me.", prefix: "North: " }, text: "patched" },
    { kind: "replace-quote", target: { quote: "patched" }, text: "complete" },
    { kind: "thread-reply", threadId: thread.id, ifThreadRevision: semantic, body: "Agent reply" },
    { kind: "thread-resolve", threadId: thread.id, ifThreadRevision: semantic },
  ] }, { actor: "agent:test", currentRevision: "global" });
  assert.match(result.draft.text, /North: complete/); assert.equal(result.draft.threads[0]!.state, "resolved");
  assert.equal(result.summary.changes.length, 2); assert.equal(result.summary.created.messageIds.length, 1);
  assert.equal(draft.text, text); assert.equal(draft.threads[0]!.state, "open");
});

test("a later ambiguous passage or stale thread refuses the complete batch", async () => {
  const text = "North: replace me. South: replace me. Tail", thread = { ...reviewThread(`Before ${text}`), anchor: makeAnchor(text, 0, 5) }, draft = { text, threads: [thread] };
  await assert.rejects(() => evaluateApply(draft, { operations: [
    { kind: "replace-quote", target: { quote: "Tail" }, text: "gone" },
    { kind: "replace-quote", target: { quote: "replace me." }, text: "bad" },
  ] }, { actor: "agent:test", currentRevision: "g" }), /ambiguous/);
  await assert.rejects(() => evaluateApply(draft, { operations: [
    { kind: "replace-quote", target: { quote: "Tail" }, text: "gone" },
    { kind: "thread-reply", threadId: thread.id, ifThreadRevision: `st1.${"0".repeat(64)}`, body: "bad" },
  ] }, { actor: "agent:test", currentRevision: "g" }), /Thread conflict/);
  assert.equal(draft.text, text); assert.equal(draft.threads[0]!.messages.length, 1);
});

test("passage matching counts overlaps and rejects malformed Unicode selectors", async () => {
  await assert.rejects(() => evaluateApply({ text: "aaa", threads: [] }, { operations: [{ kind: "replace-quote", target: { quote: "aa" }, text: "x" }] },
    { actor: "agent:test", currentRevision: "g" }), /ambiguous/);
  for (const quote of ["", "\ud83c"]) assert.throws(() => parseApplyEnvelope({ operations: [{ kind: "replace-quote", target: { quote }, text: "x" }] }));
  assert.throws(() => parseApplyEnvelope({ operations: [{ kind: "replace-quote", target: { quote: "a", prefix: "x".repeat(257) }, text: "x" }] }));
});

test("focused range, passage and thread reads stay bounded", async () => {
  const text = `🌿North: replace me. South: replace me.${"x".repeat(20_000)}`, thread = { ...reviewThread(`Before ${text}`), anchor: makeAnchor(text, 2, 7) }, draft = { text, threads: [thread] };
  assert.deepEqual(focusDraft(draft, { contract: "sideleaf-focus/v1", kind: "range", from: 2, to: 7 }), { kind: "range", range: { from: 2, to: 7 }, text: "North" });
  const passage = focusDraft(draft, { contract: "sideleaf-focus/v1", kind: "passage", target: { quote: "replace me.", prefix: "North: " }, before: 4096, after: 4096 });
  assert.equal(passage.kind, "passage"); if (passage.kind === "passage") assert.ok(passage.text.length <= 16_384);
  const focused = focusDraft(draft, { contract: "sideleaf-focus/v1", kind: "thread", threadId: thread.id });
  assert.equal(focused.kind, "thread");
});

test("legacy and embedded thread guards cannot conflict or apply to source operations", async () => {
  const text = "Before Hello 🌿 world", thread = reviewThread(text), semantic = await threadRevision(thread);
  await assert.rejects(() => evaluateApply({ text, threads: [thread] }, { operations: [{ kind: "thread-reply", threadId: thread.id, ifThreadRevision: semantic, body: "reply" }] },
    { actor: "agent:test", currentRevision: "g", ifThreadRevision: `st1.${"0".repeat(64)}` }), /Conflicting thread revision/);
  await assert.rejects(() => evaluateApply({ text, threads: [thread] }, { ifRevision: "g", operations: [{ kind: "replace-quote", target: { quote: "Before" }, text: "After" }] },
    { actor: "agent:test", currentRevision: "g", ifThreadRevision: semantic }), /does not accept/);
  const quoteOnly = await evaluateApply({ text, threads: [thread] }, { operations: [
    { kind: "replace-quote", target: { quote: "Before" }, text: "After" },
    { kind: "thread-add-quote", target: { quote: "After" }, body: "Review" },
  ] }, { actor: "agent:test", currentRevision: "g" });
  assert.equal(quoteOnly.draft.text.startsWith("After"), true); assert.equal(quoteOnly.draft.threads.length, 2);
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
