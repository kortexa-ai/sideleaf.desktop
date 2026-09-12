import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";
import { EditorBuffer } from "../src/ui/workspace.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { CollaborationError, evaluateApply, liveRevision } from "../src/collaboration/operations.ts";
import type { DocumentSnapshot } from "../src/shared/contracts.ts";

function buffer(id: string, text: string) {
  const snapshot: DocumentSnapshot = { id, name: `${id}.md`, path: `/${id}.md`, text, comments: [], lineEnding: "\n", notice: null };
  return new EditorBuffer(snapshot, EditorState.create({ doc: text, extensions: [history(), commentField, commentHistory] }));
}
test("inactive buffers retain independent text, selection, comments and undo/redo history", () => {
  const a = buffer("a", "Alpha"), b = buffer("b", "Beta");
  a.state = a.state.update({ changes: { from: 5, insert: " edited" }, selection: { anchor: 12 } }).state;
  const comment = { id: "c", body: "A thought", createdAt: "2026-09-11", anchor: makeAnchor(a.state.doc.toString(), 0, 5) };
  a.state = a.state.update({ effects: setComments.of([comment]) }).state;
  b.state = b.state.update({ changes: { from: 4, insert: " too" } }).state;
  assert.equal(a.state.doc.toString(), "Alpha edited"); assert.equal(a.state.selection.main.head, 12);
  assert.equal(a.draft().comments[0]!.body, "A thought"); assert.equal(b.state.doc.toString(), "Beta too");
  const target = { get state() { return a.state; }, dispatch: (transaction: Transaction) => { a.state = transaction.state; } };
  assert.equal(undo(target), true); assert.equal(a.draft().comments.length, 0);
  assert.equal(redo(target), true); assert.equal(a.draft().comments.length, 1);
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
test("pending comment drafts and recovery state stay attached to the buffer", () => {
  const a = buffer("a", "Alpha"), b = buffer("b", "Beta");
  a.pendingAnchor = makeAnchor("Alpha", 0, 5); a.commentBody = "unfinished"; a.editorTop = 410; a.previewTop = 250;
  assert.equal(a.hasCommentDraft, true); assert.equal(b.hasCommentDraft, false);
  assert.equal(a.editorTop, 410); assert.equal(a.previewTop, 250);
  const restored = new EditorBuffer({ ...a.metadata, ...a.draft() }, a.state, true);
  assert.equal(restored.dirty, true);
});
test("reloading a document advances its live generation and rejects the pre-reload revision", () => {
  const instance = crypto.randomUUID(), a = buffer(crypto.randomUUID(), "before");
  a.generation = 7;
  const before = liveRevision(instance, a.metadata.id, a.generation);
  const snapshot: DocumentSnapshot = { ...a.metadata, text: "external", comments: [] };
  const next = EditorBuffer.reloaded(snapshot, EditorState.create({ doc: snapshot.text, extensions: [commentField] }), a);
  const after = liveRevision(instance, next.metadata.id, next.generation);
  assert.notEqual(after, before); assert.equal(next.generation, 8);
  assert.throws(() => evaluateApply(next.draft(), { operations: [{ kind: "replace", from: 0, to: 8, text: "lost" }] }, before, after),
    (error: CollaborationError) => error.code === "CONFLICT");
});
