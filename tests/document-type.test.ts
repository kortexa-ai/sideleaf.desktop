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
import { isPlainText, documentViewMode } from "../src/shared/document-type.ts";
import { documentMode, documentExtensions } from "../src/ui/document-mode.ts";
import { commentField, commentHistory, setComments } from "../src/ui/comments.ts";

test("filename type guards every view request without changing the Markdown choice", () => {
  for (const name of ["notes.txt", "café 葉.TXT", "C:\\notes\\draft.Txt"]) {
    assert.equal(isPlainText(name), true);
    for (const mode of ["write", "split", "read"] as const) assert.equal(documentViewMode(name, mode), "write");
  }
  for (const name of ["Untitled.md", "notes.markdown", "txt.md", "notes.txt.md", "notes"]) {
    assert.equal(isPlainText(name), false);
    assert.equal(documentViewMode(name, "read"), "read");
  }
});

test("Save As and Rename change type only on success, retaining annotated text and encoding", () => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-type-")), path = join(folder, "café.md");
  writeFileSync(path, "\uFEFF# Literal *text*\r\n- One\r\n");
  const file = DocumentFile.open(path), draft = file.snapshot();
  draft.comments.push({ id: "one", createdAt: "today", body: "Keep this", anchor: makeAnchor(draft.text, 2, 9) });
  const target = join(folder, "葉.TXT");
  const text = file.save(draft, target);
  assert.equal(isPlainText(text.name), true);
  assert.equal(text.lineEnding, "\r\n");
  assert.equal(readFileSync(target)[0], 0xef);
  assert.equal(splitMetadata(decodeMarkdown(readFileSync(target)).text).text, draft.text);
  assert.deepEqual(DocumentFile.open(target).snapshot().comments, draft.comments);
  assert.throws(() => file.save(draft, join(folder, "missing", "failed.md")));
  assert.equal(file.name, "葉.TXT");
  assert.throws(() => file.rename("café.md"), /already exists/);
  assert.equal(file.name, "葉.TXT");
  assert.equal(isPlainText(file.rename("renamed.markdown").name), false);
  assert.equal(isPlainText(file.save(draft, join(folder, "again.txt")).name), true);
  assert.equal(isPlainText(file.save(draft, join(folder, "copy.md")).name), false);
  assert.deepEqual(DocumentFile.open(file.path!).snapshot().comments, draft.comments);
  const fresh = new DocumentFile();
  assert.equal(fresh.name, "Untitled.md");
  assert.equal(fresh.save({ text: "# Still literal", comments: [] }, join(folder, "new.txt")).name, "new.txt");
  assert.equal(readFileSync(fresh.path!, "utf8"), "# Still literal");
});

test("plain-text recovery remains an untitled text copy across repeated recovery", () => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-type-recovery-")), path = join(folder, "original.TXT");
  writeFileSync(path, "Original");
  const file = DocumentFile.open(path), store = new RecoveryStore(join(folder, "recovery"));
  store.save({ id: file.id, originalPath: path, revision: file.revision(), draft: { text: "Unsaved", comments: [] } });
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
  const comment = { id: "one", createdAt: "today", body: "Keep", anchor: makeAnchor(state.doc.toString(), 2, 5) };
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
