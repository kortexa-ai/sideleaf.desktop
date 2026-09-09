import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DocumentFile } from "../src/document/files.ts";
import { embedMetadata, splitMetadata, hash } from "../src/document/metadata.ts";
import { makeAnchor } from "../src/document/anchors.ts";

const fixture = () => { const path = join(mkdtempSync(join(tmpdir(), "sideleaf-metadata-")), "a.md"); writeFileSync(path, "Hello 🌿"); return path; };
test("embedded JSON escapes HTML terminators and preserves source without final newline", () => {
  const text = "Hello 🌿";
  const comments = [{ id: "a", body: "-->\n<!-- sideleaf:metadata\n & < >", createdAt: "today", anchor: makeAnchor(text, 0, 5) }];
  const metadata = { format: "sideleaf-comments" as const, version: 1 as const, revisions: [{ sourceHash: hash(text), comments }] };
  const result = embedMetadata(text, metadata);
  assert.equal(result.match(/-->/g)?.length, 1);
  assert.deepEqual(splitMetadata(result), { text, metadata });
  assert.throws(() => splitMetadata(result.slice(0, -3)), /Malformed/);
  assert.throws(() => splitMetadata(result + "extra"), /Malformed/);
  assert.throws(() => splitMetadata(result.replace('"version":1', '"version":2')), /unsupported/);
});
test("plain unchanged save keeps exact bytes and inode", () => {
  const path = fixture(), before = statSync(path); const file = DocumentFile.open(path);
  file.save(file.snapshot()); assert.equal(statSync(path).ino, before.ino); assert.equal(statSync(path).mtimeMs, before.mtimeMs);
});
test("cooperative lock refuses a concurrent writer and keeps the draft", () => {
  const path = fixture(); const file = DocumentFile.open(path); writeFileSync(`${path}.sideleaf.lock`, "owner");
  assert.throws(() => file.save({ text: "Oops", comments: [] }), /holds this document/);
  assert.equal(readFileSync(path, "utf8"), "Hello 🌿");
});
test("metadata-only changes invalidate stale snapshots and Save As retains history", () => {
  const path = fixture(); const a = DocumentFile.open(path), b = DocumentFile.open(path);
  const draft = a.snapshot(); draft.comments.push({ id: "a", body: "Thought", createdAt: "today", anchor: makeAnchor(draft.text, 0, 5) });
  a.save(draft); assert.equal(b.changed(), true); assert.throws(() => b.save(b.snapshot()), /changed on disk/);
  const copy = `${path}-copy.md`; a.save(draft, copy);
  assert.deepEqual(DocumentFile.open(copy).snapshot().comments, draft.comments); assert.ok(DocumentFile.open(copy).history().length);
  assert.equal(existsSync(`${copy}.sideleaf.json`), false);
});
test("disagreeing embedded and legacy metadata fails without dropping either copy", () => {
  const path = fixture(); const a = DocumentFile.open(path); const draft = a.snapshot();
  draft.comments.push({ id: "a", body: "Thought", createdAt: "today", anchor: makeAnchor(draft.text, 0, 5) }); a.save(draft);
  writeFileSync(`${path}.sideleaf.json`, JSON.stringify({ format: "sideleaf-comments", version: 1, revisions: [{ sourceHash: hash("Other"), comments: [] }] }));
  assert.throws(() => DocumentFile.open(path), /disagree/);
});

test("unchanged annotated saves and Save As preserve retained revisions", () => {
  const path = fixture(); const file = DocumentFile.open(path); const draft = file.snapshot();
  draft.comments.push({ id: "a", body: "First", createdAt: "today", anchor: makeAnchor(draft.text, 0, 5) });
  file.save(draft); draft.comments[0]!.body = "Second"; file.save(draft);
  const before = readFileSync(path), history = file.history(), revision = file.revision();
  for (let i = 0; i < 5; i++) file.save(draft);
  assert.deepEqual(readFileSync(path), before); assert.deepEqual(file.history(), history); assert.equal(file.revision(), revision);
  file.save(draft, `${path}-copy.md`); assert.deepEqual(file.history(), history);
});
