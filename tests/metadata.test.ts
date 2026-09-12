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
  const threads = [{ id: "a", state: "open" as const, anchor: makeAnchor(text, 0, 5), messages: [{ id: "a", body: "-->\n<!-- sideleaf:metadata\n & < >", createdAt: "today" }] }];
  const metadata = { format: "sideleaf-comments" as const, version: 3 as const, revisions: [{ sourceHash: hash(text), threads }] };
  const result = embedMetadata(text, metadata);
  assert.equal(result.match(/-->/g)?.length, 1);
  assert.deepEqual(splitMetadata(result), { text, metadata });
  assert.throws(() => splitMetadata(result.slice(0, -3)), /Malformed/);
  assert.throws(() => splitMetadata(result + "extra"), /Malformed/);
  assert.throws(() => splitMetadata(result.replace('"version":3', '"version":4')), /unsupported/);
});
test("plain unchanged save keeps exact bytes and inode", () => {
  const path = fixture(), before = statSync(path); const file = DocumentFile.open(path);
  file.save(file.snapshot()); assert.equal(statSync(path).ino, before.ino); assert.equal(statSync(path).mtimeMs, before.mtimeMs);
});
test("cooperative lock refuses a concurrent writer and keeps the draft", () => {
  const path = fixture(); const file = DocumentFile.open(path); writeFileSync(`${path}.sideleaf.lock`, "owner");
  assert.throws(() => file.save({ text: "Oops", threads: [] }), /holds this document/);
  assert.equal(readFileSync(path, "utf8"), "Hello 🌿");
});
test("metadata-only changes invalidate stale snapshots and Save As retains history", () => {
  const path = fixture(); const a = DocumentFile.open(path), b = DocumentFile.open(path);
  const draft = a.snapshot(); draft.threads.push({ id: "a", state: "open", anchor: makeAnchor(draft.text, 0, 5), messages: [{ id: "a", body: "Thought", createdAt: "today" }] });
  a.save(draft); assert.equal(b.changed(), true); assert.throws(() => b.save(b.snapshot()), /changed on disk/);
  const copy = `${path}-copy.md`; a.save(draft, copy);
  assert.deepEqual(DocumentFile.open(copy).snapshot().threads, draft.threads); assert.ok(DocumentFile.open(copy).history().length);
  assert.equal(existsSync(`${copy}.sideleaf.json`), false);
});
test("disagreeing embedded and legacy metadata fails without dropping either copy", () => {
  const path = fixture(); const a = DocumentFile.open(path); const draft = a.snapshot();
  draft.threads.push({ id: "a", state: "open", anchor: makeAnchor(draft.text, 0, 5), messages: [{ id: "a", body: "Thought", createdAt: "today" }] }); a.save(draft);
  writeFileSync(`${path}.sideleaf.json`, JSON.stringify({ format: "sideleaf-comments", version: 1, revisions: [{ sourceHash: hash("Other"), comments: [] }] }));
  assert.throws(() => DocumentFile.open(path), /disagree/);
});

test("unchanged annotated saves and Save As preserve retained revisions", () => {
  const path = fixture(); const file = DocumentFile.open(path); const draft = file.snapshot();
  draft.threads.push({ id: "a", state: "open", anchor: makeAnchor(draft.text, 0, 5), messages: [{ id: "a", body: "First", createdAt: "today" }] });
  file.save(draft); draft.threads[0]!.messages[0]!.body = "Second"; file.save(draft);
  const before = readFileSync(path), history = file.history(), revision = file.revision();
  for (let i = 0; i < 5; i++) file.save(draft);
  assert.deepEqual(readFileSync(path), before); assert.deepEqual(file.history(), history); assert.equal(file.revision(), revision);
  file.save(draft, `${path}-copy.md`); assert.deepEqual(file.history(), history);
});

test("editing a reopened snapshot cannot mutate prior saved comment revisions", () => {
  const path = fixture(); let file = DocumentFile.open(path); let draft = file.snapshot();
  draft.threads.push({ id: "a", state: "open", anchor: makeAnchor(draft.text, 0, 5), messages: [{ id: "a", body: "Original", createdAt: "today" }] }); file.save(draft);
  file = DocumentFile.open(path); draft = file.snapshot(); draft.threads[0]!.messages[0]!.body = "Updated";
  assert.equal(file.snapshot().threads[0]!.messages[0]!.body, "Original"); file.save(draft, undefined, "agent:test");
  const history = DocumentFile.open(path).history(); assert.equal(history[0]!.actor, "agent:test"); assert.equal(history[1]!.threads[0]!.messages[0]!.body, "Original");
});

test("v1 revisions migrate stable IDs, anchors, attribution and retained history", () => {
  const text = "Hello 🌿", comment = { id: "legacy", body: "Old", createdAt: "today", author: "human", anchor: makeAnchor(text, 0, 5) };
  const block = `\n\n<!-- sideleaf:metadata\n${JSON.stringify({ format: "sideleaf-comments", version: 1, revisions: [
    { sourceHash: hash(text), comments: [comment] }, { sourceHash: hash("older"), comments: [{ ...comment, body: "Older" }] },
  ] })}\n-->\n`;
  const parsed = splitMetadata(text + block).metadata!;
  assert.equal(parsed.version, 3); assert.equal(parsed.revisions.length, 2);
  assert.equal(parsed.revisions[0]!.threads[0]!.id, "legacy"); assert.equal(parsed.revisions[0]!.threads[0]!.messages[0]!.id, "legacy");
  assert.equal(parsed.revisions[0]!.threads[0]!.messages[0]!.author, "human");
});

test("v2 thread metadata upgrades to v3 without changing IDs, anchors or retained history", () => {
  const path = fixture(), text = "Hello 🌿", anchor = makeAnchor(text, 0, 5);
  const revisions = [{ sourceHash: hash(Buffer.from(text)), threads: [{ id: "stable", state: "resolved", anchor,
    messages: [{ id: "stable", body: "Root", createdAt: "2026-09-12T18:00:00.000Z", author: "agent" },
      { id: "reply", body: "Reply", createdAt: "2026-09-12T18:01:00.000Z", author: "human" }],
    resolvedAt: "2026-09-12T18:02:00.000Z", resolvedBy: "human" }] },
  { sourceHash: hash(Buffer.from("Older")), threads: [{ id: "stable", state: "open", anchor: { ...anchor, state: "orphaned" },
    messages: [{ id: "stable", body: "Older root", createdAt: "2026-09-12T17:00:00.000Z" }] }] }];
  const v2 = { format: "sideleaf-comments", version: 2, revisions };
  writeFileSync(path, `${text}\n\n<!-- sideleaf:metadata\n${JSON.stringify(v2)}\n-->\n`);
  const file = DocumentFile.open(path), before = file.history(); file.save(file.snapshot());
  const parsed = splitMetadata(readFileSync(path, "utf8")).metadata!;
  assert.equal(parsed.version, 3); assert.deepEqual(parsed.revisions, before);
  assert.equal(parsed.revisions[0]!.threads[0]!.messages[1]!.id, "reply");
});

test("the next explicit unchanged save upgrades embedded v1 metadata to v3", () => {
  const path = fixture(), text = "Hello 🌿", comment = { id: "legacy", body: "Old", createdAt: "today", anchor: makeAnchor(text, 0, 5) };
  const legacy = { format: "sideleaf-comments", version: 1, revisions: [{ sourceHash: hash(text), comments: [comment] }] };
  writeFileSync(path, `${text}\n\n<!-- sideleaf:metadata\n${JSON.stringify(legacy)}\n-->\n`);
  const file = DocumentFile.open(path), draft = file.snapshot();
  assert.equal(draft.threads[0]!.messages[0]!.author, undefined);
  file.save(draft);
  const written = readFileSync(path, "utf8");
  assert.equal(JSON.parse(written.match(/<!-- sideleaf:metadata\n(.+)\n-->\n$/s)![1]!).version, 3);
  assert.equal(DocumentFile.open(path).snapshot().threads[0]!.id, "legacy");
});
