import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";
import { EditorBuffer, refreshUntitledRecoveries } from "../src/ui/workspace.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { CollaborationError, evaluateApply, liveRevision } from "../src/collaboration/operations.ts";
import type { DocumentSnapshot } from "../src/shared/contracts.ts";

function buffer(id: string, text: string) {
  const snapshot: DocumentSnapshot = { id, name: `${id}.md`, path: `/${id}.md`, text, threads: [], lineEnding: "\n", notice: null };
  return new EditorBuffer(snapshot, EditorState.create({ doc: text, extensions: [history(), commentField, commentHistory] }));
}
test("inactive buffers retain independent text, selection, comments and undo/redo history", () => {
  const a = buffer("a", "Alpha"), b = buffer("b", "Beta");
  a.state = a.state.update({ changes: { from: 5, insert: " edited" }, selection: { anchor: 12 } }).state;
  const comment = { id: "c", state: "open" as const, anchor: makeAnchor(a.state.doc.toString(), 0, 5), messages: [{ id: "c", body: "A thought", createdAt: "2026-09-11" }] };
  a.state = a.state.update({ effects: setComments.of([comment]) }).state;
  b.state = b.state.update({ changes: { from: 4, insert: " too" } }).state;
  assert.equal(a.state.doc.toString(), "Alpha edited"); assert.equal(a.state.selection.main.head, 12);
  assert.equal(a.draft().threads[0]!.messages[0]!.body, "A thought"); assert.equal(b.state.doc.toString(), "Beta too");
  const target = { get state() { return a.state; }, dispatch: (transaction: Transaction) => { a.state = transaction.state; } };
  assert.equal(undo(target), true); assert.equal(a.draft().threads.length, 0);
  assert.equal(redo(target), true); assert.equal(a.draft().threads.length, 1);
  assert.equal(b.dirty, true);
});
test("a late save result applies only its exact snapshot and cannot clear newer edits", () => {
  const a = buffer("a", "Alpha"), b = buffer("b", "Beta");
  a.state = a.state.update({ changes: { from: 5, insert: " sent" } }).state;
  const sent = a.state;
  a.state = a.state.update({ changes: { from: 10, insert: " later" } }).state;
  a.saved(a.metadata, sent);
  assert.equal(a.dirty, true); assert.equal(a.state.doc.toString(), "Alpha sent later");
  assert.equal(b.dirty, false); assert.equal(b.state.doc.toString(), "Beta");
  assert.throws(() => b.saved(a.metadata, sent), /another document/);
  a.saved(a.metadata, a.state); assert.equal(a.dirty, false);
});
test("async mutations cannot commit after editor state or generation changes", () => {
  const a = buffer("a", "Alpha"), guard = a.guard();
  assert.equal(a.guardedBy(guard), true);
  a.state = a.state.update({ changes: { from: 5, insert: " human" } }).state;
  assert.equal(a.guardedBy(guard), false);
  const second = a.guard(); a.generation++;
  assert.equal(a.guardedBy(second), false);
  a.composer = { kind: "reply", threadId: "missing", body: "first", baseSemantic: "old" };
  const third = a.guard(); a.composer.body = "newer human text";
  assert.equal(a.guardedBy(third), false);
});
test("a recovery completion cannot mark newer composer text as durable", () => {
  const a = buffer("a", "Alpha");
  a.composer = { kind: "reply", threadId: "missing", body: "first", baseSemantic: "old" };
  const sent = a.recoveryPayload(), generation = a.generation;
  a.composer.body = "newer text";
  assert.equal(a.markRecovery(sent, generation), false);
  assert.equal(a.recoveryGeneration, -1); assert.equal(a.recoveryJSON, null);
});
test("cross-buffer recovery refuses close if an earlier snapshot changes during a later write", async () => {
  const a = buffer("a", "Alpha"), b = buffer("b", "Beta");
  a.metadata.path = null; b.metadata.path = null;
  a.composer = { kind: "reply", threadId: "missing", body: "first", baseSemantic: "old" };
  b.state = b.state.update({ changes: { from: b.state.doc.length, insert: " dirty" } }).state;
  a.markRecovery(a.recoveryPayload(), a.generation);
  const approved = await refreshUntitledRecoveries([a, b], async (target) => {
    if (target === b) a.composer!.body = "newer words";
    return target.markRecovery(target.recoveryPayload(), target.generation);
  });
  assert.equal(approved, false);
  assert.notEqual(a.recoveryJSON, a.recoveryPayload());
});
test("pending comment drafts and recovery state stay attached to the buffer", () => {
  const a = buffer("a", "Alpha"), b = buffer("b", "Beta");
  a.pendingAnchor = makeAnchor("Alpha", 0, 5); a.commentBody = "unfinished"; a.editorTop = 410; a.previewTop = 250;
  assert.equal(a.hasCommentDraft, true); assert.equal(b.hasCommentDraft, false);
  assert.equal(a.editorTop, 410); assert.equal(a.previewTop, 250);
  const restored = new EditorBuffer({ ...a.metadata, ...a.draft() }, a.state, true);
  assert.equal(restored.dirty, true);
});
test("reloading a document advances its live generation and rejects the pre-reload revision", async () => {
  const instance = crypto.randomUUID(), a = buffer(crypto.randomUUID(), "before");
  a.generation = 7;
  const before = liveRevision(instance, a.metadata.id, a.generation);
  const snapshot: DocumentSnapshot = { ...a.metadata, text: "external", threads: [] };
  const next = EditorBuffer.reloaded(snapshot, EditorState.create({ doc: snapshot.text, extensions: [commentField] }), a);
  const after = liveRevision(instance, next.metadata.id, next.generation);
  assert.notEqual(after, before); assert.equal(next.generation, 8);
  await assert.rejects(() => evaluateApply(next.draft(), { operations: [{ kind: "replace", from: 0, to: 8, text: "lost" }] }, { actor: "agent", ifRevision: before, currentRevision: after }),
    (error: CollaborationError) => error.code === "CONFLICT");
});
