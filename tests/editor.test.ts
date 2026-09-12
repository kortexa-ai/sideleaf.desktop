import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { history, undo, redo, isolateHistory } from "@codemirror/commands";
import { agentHighlightField, commentField, commentHistory, composeAgentChanges, setAgentHighlights, setComments } from "../src/ui/comments.ts";
import { commentRange, makeAnchor } from "../src/document/anchors.ts";
import { renderMarkdown } from "../src/ui/markdown.ts";

test("comments follow UTF-16 edits and survive delete/undo/redo in CodeMirror history", () => {
  let state = EditorState.create({ doc: "Hello 🌿 world", extensions: [history(), commentField, commentHistory] });
  const comment = { id: "one", state: "open" as const, anchor: makeAnchor(state.doc.toString(), 6, 8), messages: [{ id: "one", body: "Keep leaf", createdAt: "today" }] };
  state = state.update({ effects: setComments.of([comment]), annotations: isolateHistory.of("full") }).state;
  state = state.update({ changes: { from: 0, insert: "Before " }, annotations: isolateHistory.of("full") }).state;
  assert.equal(state.field(commentField)[0]!.anchor.from, 13);
  state = state.update({ changes: { from: 13, to: 15 }, annotations: isolateHistory.of("full") }).state;
  assert.equal(state.field(commentField)[0]!.anchor.state, "orphaned");
  const target = { get state() { return state; }, dispatch: (transaction: { state: EditorState }) => { state = transaction.state; } };
  assert.equal(undo(target), true); assert.equal(state.field(commentField)[0]!.anchor.state, "attached");
  assert.equal(state.doc.sliceString(13, 15), "🌿");
  assert.equal(undo(target), true); assert.equal(state.field(commentField)[0]!.anchor.from, 6);
  assert.equal(undo(target), true); assert.equal(state.field(commentField).length, 0);
  assert.equal(redo(target), true); assert.deepEqual(state.field(commentField), [comment]);
});

test("an empty comment selection expands to the complete current line", () => {
  const text = "First line\nThe current line\nLast line";
  assert.deepEqual(commentRange(text, 18, 18), { from: 11, to: 27 });
  assert.deepEqual(commentRange(text, 2, 7), { from: 2, to: 7 });
  assert.throws(() => commentRange("First\n\nThird", 6, 6), /Write something on this line/);
});

test("Markdown cannot inject scripts, privileged links, raw HTML or remote images", () => {
  const rendered = renderMarkdown('<script>window.__electrobun.pwn()</script>\n\n[x](javascript:alert(1))\n\n![alt](https://tracker.test/pixel)\n\n[safe](https://sideleaf.xyz)');
  assert.ok(!rendered.includes("<script>")); assert.ok(!rendered.includes("<img"));
  assert.ok(!rendered.includes('href="javascript:')); assert.ok(rendered.includes('href="https://sideleaf.xyz"'));
  assert.ok(rendered.includes("loading disabled"));
});

test("sequential agent edits preserve selection and map only surviving exact highlights", () => {
  let state = EditorState.create({ doc: "abcdef", selection: { anchor: 6 }, extensions: [agentHighlightField] });
  const composed = composeAgentChanges(state.doc.length, [
    { operation: 0, from: 0, to: 1, text: "XX" },
    { operation: 1, from: 3, to: 5, text: "Z" },
    { operation: 2, from: 0, to: 2, text: "Q" },
  ]);
  state = state.update({ changes: composed.changes, effects: setAgentHighlights.of(composed.highlights), userEvent: "input.agent" }).state;
  assert.equal(state.doc.toString(), "QbZef"); assert.equal(state.selection.main.head, 5);
  assert.deepEqual(composed.highlights, [{ from: 2, to: 3 }, { from: 0, to: 1 }]);
  assert.equal(state.field(agentHighlightField).size, 2);
  state = state.update({ changes: { from: 5, insert: "!" }, userEvent: "input.type" }).state;
  assert.equal(state.field(agentHighlightField).size, 0);
});
