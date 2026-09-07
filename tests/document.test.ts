import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, statSync, chmodSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentFile, decodeMarkdown } from "../src/document/files.ts";
import { makeAnchor, relocateComment } from "../src/document/anchors.ts";
import { validateDraft } from "../src/shared/contracts.ts";

const fixture = (bytes = Buffer.from("# Notes\n\nHello 🌿 café.\n")) => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-test-"));
  const path = join(folder, "notes.md"); writeFileSync(path, bytes); return { folder, path };
};

test("a literal UTF-8 BOM/CRLF file survives comment save without rewriting", () => {
  const bytes = Buffer.from("\uFEFF# Notes\r\n\r\nHello 🌿 café.\r\n");
  const { path } = fixture(bytes); const file = DocumentFile.open(path);
  const draft = file.snapshot();
  draft.comments.push({ id: "one", createdAt: "2026-09-07", body: "Keep this wording", anchor: makeAnchor(draft.text, 9, 22) });
  file.save(draft);
  assert.deepEqual(readFileSync(path), bytes);
  const reopened = DocumentFile.open(path).snapshot();
  assert.deepEqual(reopened.comments, draft.comments);
  assert.equal(reopened.lineEnding, "\r\n");
});

test("disk edits, metadata edits, deletion, and replacement cannot silently overwrite a draft", () => {
  const { path } = fixture(); const file = DocumentFile.open(path); const draft = { ...file.snapshot(), text: "My unsaved draft" };
  writeFileSync(path, "Another writer"); assert.equal(file.changed(), true);
  assert.throws(() => file.save(draft), /changed on disk/); assert.equal(readFileSync(path, "utf8"), "Another writer");
  const loaded = file.reload(); assert.equal(loaded.text, "Another writer");
  writeFileSync(`${path}.sideleaf.json`, "bad metadata");
  assert.throws(() => file.save({ ...loaded, text: "Mine" }), /changed on disk/);
});

test("plain save preserves mode and leaves no sidecar until comments exist", () => {
  const { path } = fixture(); if (process.platform !== "win32") chmodSync(path, 0o640);
  const file = DocumentFile.open(path); file.save({ text: "# Edited\n", comments: [] });
  assert.equal(readFileSync(path, "utf8"), "# Edited\n");
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o640);
  assert.equal(file.changed(), false);
});

test("Save As keeps the original document and rejects another document's annotations", () => {
  const { path, folder } = fixture(); const file = DocumentFile.open(path); const original = readFileSync(path);
  const target = join(folder, "copy.md"); file.save({ text: "New copy", comments: [] }, target);
  assert.deepEqual(readFileSync(path), original); assert.equal(file.path, realpathSync(target));
  const collision = join(folder, "annotated.md"); writeFileSync(collision, "Other"); writeFileSync(`${collision}.sideleaf.json`, "{}");
  assert.throws(() => file.save({ text: "Oops", comments: [] }, collision), /already has Sideleaf comments/);
  assert.equal(readFileSync(collision, "utf8"), "Other");
});

test("the two-revision sidecar recovers the correct comments if source replacement was interrupted", () => {
  const { path } = fixture(); const file = DocumentFile.open(path); const original = readFileSync(path);
  const old = file.snapshot();
  old.comments.push({ id: "old", body: "Original", createdAt: "2026-09-07", anchor: makeAnchor(old.text, 2, 7) });
  file.save(old);
  file.save({ text: `${old.text}Later\n`, comments: [...old.comments, { id: "new", body: "Later thought", createdAt: "2026-09-07", anchor: makeAnchor(`${old.text}Later\n`, old.text.length, old.text.length + 5) }] });
  writeFileSync(path, original);
  const recovered = DocumentFile.open(path).snapshot();
  assert.deepEqual(recovered.comments, old.comments); assert.match(recovered.notice!, /interrupted save/);
});

test("failed destination writes leave original bytes intact", () => {
  const { path, folder } = fixture(); const file = DocumentFile.open(path); const bytes = readFileSync(path);
  const directory = join(folder, "directory.md"); mkdirSync(directory);
  assert.throws(() => file.save({ text: "changed", comments: [] }, directory), /regular file/);
  assert.deepEqual(readFileSync(path), bytes);
});

test("invalid UTF-8, NUL and mixed line endings are explicit unsupported formats", () => {
  assert.throws(() => decodeMarkdown(Uint8Array.of(0xff, 0xfe)), /not valid UTF-8/);
  assert.throws(() => decodeMarkdown(Buffer.from("a\u0000b")), /NUL/);
  assert.throws(() => decodeMarkdown(Buffer.from("a\r\nb\n")), /Mixed/);
});

test("external relocation requires unambiguous quotation and context", () => {
  const text = "# Notes\n\nHello 🌿 café.\n";
  const comment = { id: "a", body: "Interesting", createdAt: "2026-09-07", anchor: makeAnchor(text, 9, 22) };
  const moved = relocateComment(comment, `Before\n${text}`, false);
  assert.equal(moved.anchor.from, 16); assert.equal(moved.anchor.state, "attached");
  assert.equal(relocateComment(comment, `${text}${text}`, false).anchor.state, "orphaned");
  assert.equal(relocateComment(comment, text.replace("Hello", "Goodbye"), false).anchor.state, "orphaned");
});

test("bridge validation rejects forged anchors", () => {
  assert.throws(() => validateDraft({ text: "Hello", comments: [{ id: "x", body: "x", createdAt: "today", anchor: makeAnchor("Other", 0, 5) }] }), /no longer matches/);
});

test("opening a symlink saves its resolved target without replacing the link", { skip: process.platform === "win32" }, () => {
  const { path, folder } = fixture(); const link = join(folder, "link.md"); symlinkSync(path, link);
  DocumentFile.open(link).save({ text: "Updated", comments: [] });
  assert.equal(readFileSync(path, "utf8"), "Updated");
});
