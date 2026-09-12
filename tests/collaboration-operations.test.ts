import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { CollaborationError, evaluateApply, liveRevision, parseApplyEnvelope } from "../src/collaboration/operations.ts";

test("one guarded replacement evaluates identically and remains one editor undo step", () => {
  const instance = crypto.randomUUID(), document = crypto.randomUUID();
  let state = EditorState.create({ doc: "Before Hello 🌿 world", extensions: [history(), commentField, commentHistory] });
  const comment = { id: "c", body: "leaf", createdAt: "today", anchor: makeAnchor(state.doc.toString(), 13, 15) };
  state = state.update({ effects: setComments.of([comment]), annotations: isolateHistory.of("full") }).state;
  const revision = liveRevision(instance, document, 0);
  const envelope = parseApplyEnvelope({ operations: [{ kind: "replace", from: 0, to: 0, text: "Agent " }] });
  const evaluated = evaluateApply({ text: state.doc.toString(), comments: state.field(commentField) }, envelope, revision, revision);
  const operation = envelope.operations[0];
  const selection = { anchor: 13, head: 15 };
  state = state.update({ selection }).state;
  state = state.update({ changes: { from: operation.from, to: operation.to, insert: operation.text }, effects: setComments.of(evaluated.draft.comments), annotations: isolateHistory.of("full") }).state;
  assert.equal(state.doc.toString(), "Agent Before Hello 🌿 world");
  assert.deepEqual({ anchor: state.selection.main.anchor, head: state.selection.main.head }, { anchor: 19, head: 21 });
  assert.equal(state.field(commentField)[0]!.anchor.from, 19);
  const target = { get state() { return state; }, dispatch: (transaction: Transaction) => { state = transaction.state; } };
  assert.equal(undo(target), true);
  assert.equal(state.doc.toString(), "Before Hello 🌿 world");
  assert.deepEqual(state.field(commentField), [comment]);
});

test("the foundation rejects stale, ambiguous, oversized and surrogate-splitting applies before mutation", () => {
  const revision = liveRevision(crypto.randomUUID(), crypto.randomUUID(), 3);
  const draft = { text: "A🌿B", comments: [] };
  assert.throws(() => evaluateApply(draft, { operations: [{ kind: "replace", from: 0, to: 1, text: "C" }] }, "stale", revision),
    (error: CollaborationError) => error.code === "CONFLICT");
  assert.throws(() => evaluateApply(draft, { operations: [{ kind: "replace", from: 2, to: 2, text: "x" }] }, revision, revision), /splits a Unicode/);
  assert.throws(() => parseApplyEnvelope({ operations: [] }), /exactly one/);
  assert.throws(() => parseApplyEnvelope({ operations: [{ kind: "replace", from: 0, to: 0, text: "x" }, { kind: "replace", from: 0, to: 0, text: "y" }] }), /exactly one/);
});
