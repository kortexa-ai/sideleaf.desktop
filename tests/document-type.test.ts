import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { DocumentFile, decodeMarkdown } from "../src/document/files.ts";
import { RecoveryStore } from "../src/document/scratch.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { splitMetadata } from "../src/document/metadata.ts";
import { isPlainText, documentViewMode, supportsReview } from "../src/shared/document-type.ts";
import { documentMode, documentExtensions } from "../src/ui/document-mode.ts";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";

test("filename type guards every view request without changing the Markdown choice", () => {
  for (const name of ["notes.txt", "café 葉.TXT", "C:\\notes\\draft.Txt", "config.json", ".env", "settings.INI", "notes", "notes.md.bak"]) {
    assert.equal(isPlainText(name), true);
    for (const mode of ["write", "split", "read"] as const) assert.equal(documentViewMode(name, mode), "write");
  }
  for (const name of ["Untitled.md", "notes.markdown", "txt.md", "notes.txt.md", "draft.MDOWN"]) {
    assert.equal(isPlainText(name), false);
    assert.equal(documentViewMode(name, "read"), "read");
  }
});

test("other text files open as plain text, save byte-exact and refuse comments; binary files are refused", () => {
  assert.deepEqual(["a.md", "a.txt", "a.json", ".env", "a"].map(supportsReview), [true, true, false, false, false]);
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-type-other-"));
  const cases: [string, Buffer][] = [["config.json", Buffer.from('{\r\n  "a": 1\r\n}')], [".env", Buffer.from("\uFEFFKEY=value\n\n")], ["settings.ini", Buffer.from("[x]\ny=1")]];
  for (const [name, bytes] of cases) {
    const path = join(folder, name); writeFileSync(path, bytes);
    const file = DocumentFile.open(path), draft = file.snapshot();
    assert.equal(isPlainText(draft.name), true);
    file.save({ text: draft.text, threads: [] }); assert.ok(readFileSync(path).equals(bytes));
    file.save({ text: draft.text + "z", threads: [] }); assert.ok(readFileSync(path).equals(Buffer.concat([bytes, Buffer.from("z")])));
    const thread = { id: "one", state: "open" as const, anchor: makeAnchor(draft.text, 0, 1), messages: [{ id: "one", createdAt: "today", body: "No" }] };
    assert.throws(() => file.save({ text: draft.text, threads: [thread] }), /support only \.md/);
    assert.throws(() => file.save({ text: draft.text, threads: [] }, undefined, "agent:test"), /support only \.md/);
    assert.ok(readFileSync(path).equals(Buffer.concat([bytes, Buffer.from("z")])));
  }
  writeFileSync(join(folder, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]));
  assert.throws(() => DocumentFile.open(join(folder, "image.png")), /not valid UTF-8/);
  writeFileSync(join(folder, "data.bin"), Buffer.from("ab\u0000cd"));
  assert.throws(() => DocumentFile.open(join(folder, "data.bin")), /NUL characters and looks binary/);
  writeFileSync(join(folder, "latin1.ini"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  assert.throws(() => DocumentFile.open(join(folder, "latin1.ini")), /not valid UTF-8/);
});

test("Save As and Rename change type only on success, retaining annotated text and encoding", () => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-type-")), path = join(folder, "café.md");
  writeFileSync(path, "\uFEFF# Literal *text*\r\n- One\r\n");
  const file = DocumentFile.open(path), draft = file.snapshot();
  draft.threads.push({ id: "one", state: "open", anchor: makeAnchor(draft.text, 2, 9), messages: [{ id: "one", createdAt: "today", body: "Keep this" }] });
  const target = join(folder, "葉.TXT");
  const text = file.save(draft, target);
  assert.equal(isPlainText(text.name), true);
  assert.equal(text.lineEnding, "\r\n");
  assert.equal(readFileSync(target)[0], 0xef);
  assert.equal(splitMetadata(decodeMarkdown(readFileSync(target)).text).text, draft.text);
  assert.deepEqual(DocumentFile.open(target).snapshot().threads, draft.threads);
  assert.throws(() => file.save(draft, join(folder, "missing", "failed.md")));
  assert.equal(file.name, "葉.TXT");
  assert.throws(() => file.rename("café.md"), /already exists/);
  assert.equal(file.name, "葉.TXT");
  assert.equal(isPlainText(file.rename("renamed.markdown").name), false);
  assert.equal(isPlainText(file.save(draft, join(folder, "again.txt")).name), true);
  assert.equal(isPlainText(file.save(draft, join(folder, "copy.md")).name), false);
  assert.deepEqual(DocumentFile.open(file.path!).snapshot().threads, draft.threads);
  const fresh = new DocumentFile();
  assert.equal(fresh.name, "Untitled.md");
  assert.equal(fresh.save({ text: "# Still literal", threads: [] }, join(folder, "new.txt")).name, "new.txt");
  assert.equal(readFileSync(fresh.path!, "utf8"), "# Still literal");
});

test("plain-text recovery remains an untitled text copy across repeated recovery", () => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-type-recovery-")), path = join(folder, "original.TXT");
  writeFileSync(path, "Original");
  const file = DocumentFile.open(path), store = new RecoveryStore(join(folder, "recovery"));
  store.save({ id: file.id, originalPath: path, revision: file.revision(), draft: { text: "Unsaved", threads: [] } });
  const record = store.load().records[0]!;
  const recovered = DocumentFile.fromDraft(record.draft, record.originalPath);
  assert.equal(recovered.name, "Untitled.txt"); assert.equal(recovered.path, null);
  store.clear(file.id); store.save({ ...record, id: recovered.id });
  const again = store.load().records[0]!;
  assert.equal(DocumentFile.fromDraft(again.draft, again.originalPath).name, "Untitled.txt");
  assert.equal(readFileSync(path, "utf8"), "Original");
  assert.equal(DocumentFile.fromDraft(record.draft).name, "Untitled.md");
});

test("switching editor type removes Markdown behavior and preserves text, selection, comments and undo", () => {
  let state = EditorState.create({ doc: "- One", selection: { anchor: 5 }, extensions: [history(), commentField, commentHistory, documentMode.of(documentExtensions("note.md"))] });
  const target = { get state() { return state; }, dispatch: (transaction: Transaction) => { state = transaction.state; } };
  assert.equal(insertNewlineContinueMarkup(target), true);
  assert.equal(state.doc.toString(), "- One\n- ");
  const comment = { id: "one", state: "open" as const, anchor: makeAnchor(state.doc.toString(), 2, 5), messages: [{ id: "one", createdAt: "today", body: "Keep" }] };
  state = state.update({ effects: setComments.of([comment]) }).state;
  const selection = state.selection;
  state = state.update({ effects: documentMode.reconfigure(documentExtensions("note.txt")) }).state;
  assert.equal(insertNewlineContinueMarkup(target), false);
  assert.equal(syntaxTree(state).length, 0);
  assert.ok(state.selection.eq(selection));
  assert.deepEqual(state.field(commentField), [comment]);
  assert.equal(undo(target), true); assert.equal(state.field(commentField).length, 0);
  assert.equal(undo(target), true); assert.equal(state.doc.toString(), "- One");
  assert.equal(redo(target), true); assert.equal(state.doc.toString(), "- One\n- ");
  assert.equal(redo(target), true); assert.deepEqual(state.field(commentField), [comment]);
  state = state.update({ effects: documentMode.reconfigure(documentExtensions("note.md")) }).state;
  assert.ok(syntaxTree(state).toString().includes("BulletList"));
  assert.equal(state.doc.toString(), "- One\n- ");
});
