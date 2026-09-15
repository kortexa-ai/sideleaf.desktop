import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorSelection, EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { documentExtensions, documentMode } from "../src/ui/document-mode.ts";
import { formattingShortcuts, toggleBold, toggleItalic } from "../src/ui/formatting.ts";

function editor(doc: string, anchor = 0, head = doc.length, name = "note.md") {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions: [basicSetup, documentMode.of(documentExtensions(name)), formattingShortcuts(() => true)] });
  return { get state() { return state; }, dispatch(transaction: Transaction) { state = transaction.state; } };
}

for (const [doc, from, to, command, once] of [
  ["word", 0, 4, toggleBold, "**word**"],
  ["word", 0, 4, toggleItalic, "*word*"],
  ["**word**", 2, 6, toggleBold, "word"],
  ["**word**", 0, 8, toggleBold, "word"],
  ["*word*", 1, 5, toggleItalic, "word"],
  ["*word*", 0, 6, toggleBold, "***word***"],
  ["**word**", 0, 8, toggleItalic, "***word***"],
  ["a `code` b", 0, 10, toggleBold, "**a** `code` **b**"],
  ["[label](https://example.com/a_b)", 0, 32, toggleBold, "[**label**](https://example.com/a_b)"],
  ["# Heading\n- item", 0, 16, toggleBold, "# **Heading**\n- **item**"],
  ["- [x] task", 0, 10, toggleBold, "- [x] **task**"],
  ["  café 🌿  ", 0, 11, toggleItalic, "  *café 🌿*  "],
  ["", 0, 0, toggleBold, "****"],
  ["", 0, 0, toggleItalic, "**"],
] as [string, number, number, StateCommand, string][]) {
  test(`formatting round trip ${JSON.stringify(doc)} → ${JSON.stringify(once)}`, () => {
    const target = editor(doc, from, Math.min(to, doc.length));
    assert.equal(command(target), true); assert.equal(target.state.doc.toString(), once);
    assert.equal(command(target), true); assert.equal(target.state.doc.toString(), doc);
  });
}

test("existing underscore emphasis and cursor emphasis are removed through syntax", () => {
  for (const [doc, cursor, command] of [["__word__", 4, toggleBold], ["_word_", 3, toggleItalic], ["***word***", 5, toggleBold]] as const) {
    const target = editor(doc, cursor, cursor); command(target);
    assert.equal(target.state.doc.toString(), doc === "***word***" ? "*word*" : "word");
    assert.equal(undo(target), true); assert.equal(target.state.doc.toString(), doc);
  }
});

test("protected code, links, read-only state and plain text are unchanged", () => {
  for (const [doc, from, to] of [["`code`", 1, 5], ["`code`", 3, 3], ["```\ncode\n```", 0, 12], ["    code", 4, 8], ["[label](url)", 8, 11]] as const) {
    const target = editor(doc, from, to); toggleBold(target); toggleItalic(target);
    assert.equal(target.state.doc.toString(), doc);
  }
  const plain = editor("word", 0, 4, "note.TXT"); toggleBold(plain); assert.equal(plain.state.doc.toString(), "word");
  const readonly = EditorState.create({ doc: "word", selection: { anchor: 0, head: 4 }, extensions: [documentExtensions("note.md"), EditorState.readOnly.of(true)] });
  toggleBold({ state: readonly, dispatch() { assert.fail("read-only command dispatched"); } });
});

test("mixed selection normalizes emphasis and each command is one undo step", () => {
  const target = editor("one **two**");
  toggleBold(target); assert.equal(target.state.doc.toString(), "**one two**");
  toggleBold(target); assert.equal(target.state.doc.toString(), "one two");
  undo(target); assert.equal(target.state.doc.toString(), "**one two**");
  undo(target); assert.equal(target.state.doc.toString(), "one **two**");
  redo(target); assert.equal(target.state.doc.toString(), "**one two**");
});

test("marker-only selections leave the source intact", () => {
  for (const [from, to] of [[0, 1], [7, 8]]) {
    const target = editor("**word**", from, to); toggleBold(target);
    assert.equal(target.state.doc.toString(), "**word**");
  }
});

test("actual Mod-i and Mod-b bindings toggle before basicSetup's syntax selection", () => {
  for (const key of ["Mod-i", "Mod-b"]) {
    const target = editor("word");
    const run = () => target.state.facet(keymap).flat().filter((binding) => binding.key === key).some((binding) => binding.run?.(target as never));
    assert.ok(run()); assert.equal(target.state.doc.toString(), key === "Mod-i" ? "*word*" : "**word**");
    assert.ok(run()); assert.equal(target.state.doc.toString(), "word");
  }
});

test("reversed and multiple selections retain their content and direction", () => {
  const reversed = editor("hello", 5, 0); toggleBold(reversed);
  assert.equal(reversed.state.selection.main.anchor, 7); assert.equal(reversed.state.selection.main.head, 2);
  toggleBold(reversed); assert.equal(reversed.state.selection.main.anchor, 5); assert.equal(reversed.state.selection.main.head, 0);
  const multiple = editor("one two");
  multiple.dispatch(multiple.state.update({ selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]) }));
  toggleBold(multiple); assert.equal(multiple.state.doc.toString(), "**one** **two**");
  toggleBold(multiple); assert.equal(multiple.state.doc.toString(), "one two");
});

for (const [before, after] of [
  ["- item", "- item\n- "], ["* item", "* item\n* "], ["+ item", "+ item\n+ "],
  ["1. item", "1. item\n2. "], ["1) item", "1) item\n2) "],
  ["- parent\n  - child", "- parent\n  - child\n  - "],
  ["- [ ] task", "- [ ] task\n- [ ] "], ["- [x] task", "- [x] task\n- [ ] "],
  ["- ", ""], ["- one\n- ", "- one\n"], ["1. one\n2. ", "1. one\n"], ["- [ ] ", ""], ["- [x] ", ""],
]) {
  test(`Enter and undo: ${JSON.stringify(before)}`, () => {
    const target = editor(before!, before!.length, before!.length);
    const enter = target.state.facet(keymap).flat().filter((binding) => binding.key === "Enter");
    assert.ok(enter.some((binding) => binding.run?.(target as never)));
    assert.equal(target.state.doc.toString(), after);
    undo(target); assert.equal(target.state.doc.toString(), before);
  });
}
