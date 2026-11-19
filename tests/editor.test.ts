import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { ensureSyntaxTree, foldable, foldedRanges, syntaxTree } from "@codemirror/language";
import { basicSetup } from "codemirror";
import { history, undo, redo, isolateHistory } from "@codemirror/commands";
import { agentHighlightField, commentField, commentHistory, composeAgentChanges, setAgentHighlights, setComments } from "../src/ui/comments.ts";
import { commentRange, makeAnchor } from "../src/document/anchors.ts";
import { renderMarkdown } from "../src/ui/markdown.ts";
import { documentExtensions, documentMode } from "../src/ui/document-mode.ts";
import { frontMatterField, frontMatterUnfoldEffects, isFrontMatterFolded, setFrontMatterFolded, withFrontMatterFolded } from "../src/ui/front-matter.ts";

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

test("front matter is one quiet node in the Markdown tree, folded when a document opens", () => {
  const doc = "---\ntitle: A note\ntags:\n  - a\n---\nBody\n\n---\n\nMore\n";
  const open = (text: string, name = "note.md") => withFrontMatterFolded(EditorState.create({ doc: text, extensions: [basicSetup, documentMode.of(documentExtensions(name))] }));
  let state = open(doc);
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!, names: string[] = [];
  tree.iterate({ enter: (node) => { names.push(`${node.name}@${node.from}`); } });
  assert.ok(names.includes("FrontMatter@0"));
  assert.ok(!names.some((name) => /Heading|HorizontalRule@0/.test(name)), names.join(" "));
  assert.ok(names.includes("HorizontalRule@40"));
  assert.equal(state.field(frontMatterField)!.to, 33);
  assert.equal(isFrontMatterFolded(state), true);
  assert.equal(state.selection.main.head, 34);
  assert.deepEqual(foldable(state, 0, 3), { from: 0, to: 33 });
  // An unclosed block still parses as front matter to the end, but is not foldable or detected.
  const unclosed = open("---\ntitle: x\n# Not a heading\n");
  assert.equal(syntaxTree(unclosed).topNode.firstChild!.name, "FrontMatter");
  assert.equal(unclosed.field(frontMatterField), null);
  assert.equal(isFrontMatterFolded(unclosed), false);
  assert.equal(unclosed.selection.main.head, 0);
  const plain = open(doc, "note.txt");
  assert.equal(plain.field(frontMatterField, false), undefined);
  assert.equal(isFrontMatterFolded(plain), false);
  assert.equal(plain.selection.main.head, 0);
  assert.equal(syntaxTree(plain).length, 0);

  // A body edit keeps the fold; a change at 0, at the end of the closing line, or inside the block opens it.
  state = state.update({ changes: { from: 40, insert: "x" }, userEvent: "input.type" }).state;
  assert.equal(isFrontMatterFolded(state), true);
  for (const [from, to] of [[0, 0], [33, 33], [10, 14], [32, 34]]) {
    const next = state.update({ changes: { from, to, insert: "z" } }).state;
    assert.equal(isFrontMatterFolded(next), false, `${from}-${to}`);
    assert.equal(foldedRanges(next).size, 0);
  }
  const target = { get state() { return state; }, dispatch: (spec: TransactionSpec) => { state = state.update(spec).state; } };
  assert.equal(setFrontMatterFolded(target, false), true); assert.equal(isFrontMatterFolded(state), false);
  assert.equal(setFrontMatterFolded(target, false), false);
  state = state.update({ selection: { anchor: 8 } }).state;
  assert.equal(setFrontMatterFolded(target, true), true); assert.equal(isFrontMatterFolded(state), true);
  assert.equal(state.selection.main.head, 34);
  assert.equal(frontMatterUnfoldEffects(state).length, 1);
  // Backspace or Delete beside the closed block would take it whole; the key opens it instead.
  for (const anchor of [0, 33]) {
    const next = state.update({ selection: { anchor } }).state.update({ changes: { from: 0, to: 33 }, userEvent: "delete.backward" }).state;
    assert.equal(next.doc.toString(), state.doc.toString());
    assert.equal(isFrontMatterFolded(next), false);
  }
  const selected = state.update({ selection: { anchor: 0, head: 33 } }).state.update({ changes: { from: 0, to: 33 }, userEvent: "delete.selection" }).state;
  assert.equal(selected.doc.toString().startsWith("\nBody"), true);
});

test("an undo that changes the closed block opens it", () => {
  let state = EditorState.create({ doc: "---\ntitle: x\n---\nBody", extensions: [history(), documentMode.of(documentExtensions("a.md"))] });
  state = state.update({ changes: { from: 11, insert: "y" }, annotations: isolateHistory.of("full") }).state;
  const target = { get state() { return state; }, dispatch: (transaction: { state: EditorState }) => { state = transaction.state; } };
  state = withFrontMatterFolded(state);
  assert.equal(isFrontMatterFolded(state), true);
  assert.equal(undo(target), true);
  assert.equal(state.doc.toString(), "---\ntitle: x\n---\nBody");
  assert.equal(isFrontMatterFolded(state), false);
});
