import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { wordCountField } from "../src/ui/word-count.ts";

const expected = (text: string) => text.match(/\S+/g)?.length ?? 0;

test("incremental words match full counting through Unicode edits, joins, splits and multiple changes", () => {
  let state = EditorState.create({ doc: "one two\n🌿 café\tthree\u00a0four\u2028five", extensions: [wordCountField] });
  let seed = 314159;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const inserts = ["", " ", "\n", "🌿", "hello world", "\t\u00a0\u2028", "é\u0301", "abc"];
  for (let i = 0; i < 1000; i++) {
    const from = random(state.doc.length + 1);
    const to = from + random(state.doc.length - from + 1);
    const changes = [{ from, to, insert: inserts[random(inserts.length)]! }];
    if (to < state.doc.length) changes.push({ from: to + 1, to: state.doc.length, insert: inserts[random(inserts.length)]! });
    state = state.update({ changes }).state;
    assert.equal(state.field(wordCountField), expected(state.doc.toString()), `edit ${i}: ${JSON.stringify(changes)}`);
  }
});

test("word count follows undo/redo and an empty document", () => {
  let state = EditorState.create({ extensions: [history(), wordCountField] });
  state = state.update({ changes: { from: 0, insert: "one two" } }).state;
  const target = { get state() { return state; }, dispatch: (transaction: { state: EditorState }) => { state = transaction.state; } };
  assert.equal(state.field(wordCountField), 2);
  undo(target); assert.equal(state.field(wordCountField), 0);
  redo(target); assert.equal(state.field(wordCountField), 2);
  state = state.update({ changes: [{ from: 0, to: 1, insert: "a " }, { from: 2, to: 3, insert: " b" }] }).state;
  assert.equal(state.field(wordCountField), expected(state.doc.toString()));
});
