import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAnchor } from "../src/document/anchors.ts";
import { DocumentFile } from "../src/document/files.ts";
import { ScratchStore } from "../src/document/scratch.ts";
import { RecoveryStore } from "../src/document/scratch.ts";
import { randomUUID } from "node:crypto";

const fixture = () => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-scratch-"));
  return { folder, path: join(folder, "state", "untitled-draft.json") };
};

test("scratch recovery round-trips Unicode text and comments privately", () => {
  const { path } = fixture();
  const store = new ScratchStore(path);
  const text = "# Quiet notes\n\nA sprout grows here 🌿 café.\n";
  const draft = {
    text,
    comments: [{ id: "one", body: "Keep this thought", createdAt: "2026-09-09T18:00:00.000Z", anchor: makeAnchor(text, 15, 34) }],
  };
  store.save(draft);
  assert.deepEqual(store.load(), draft);
  assert.equal(DocumentFile.fromDraft(store.load()!).snapshot().notice, null);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("invalid scratch data is rejected and preserved", () => {
  const { folder, path } = fixture();
  const store = new ScratchStore(path);
  store.save({ text: "safe", comments: [] });
  writeFileSync(path, "{not-json");
  assert.throws(() => store.load());
  assert.equal(readFileSync(path, "utf8"), "{not-json");

  const target = join(folder, "target");
  writeFileSync(target, "{}");
  const link = join(folder, "linked-draft.json");
  if (process.platform !== "win32") {
    symlinkSync(target, link);
    assert.throws(() => new ScratchStore(link).load(), /regular file/);
  }
});

test("clearing scratch recovery is idempotent", () => {
  const { path } = fixture();
  const store = new ScratchStore(path);
  store.save({ text: "temporary", comments: [] });
  store.clear();
  store.clear();
  assert.equal(existsSync(path), false);
  assert.equal(store.load(), null);
});

test("workspace recovery keeps independent named and untitled drafts without modifying originals", () => {
  const { folder } = fixture(), store = new RecoveryStore(join(folder, "recovery"));
  const original = join(folder, "original.md"); writeFileSync(original, "Disk version");
  const file = DocumentFile.open(original), a = randomUUID(), b = randomUUID();
  const draft = { text: "Unsaved Alpha", comments: [] };
  store.save({ id: a, originalPath: original, revision: file.revision(), draft, pending: { anchor: makeAnchor(draft.text, 0, 7), body: "Unfinished thought", valid: true } });
  store.save({ id: b, originalPath: null, revision: null, draft: { text: "Untitled Beta", comments: [] } });
  assert.equal(store.load().records.length, 2); assert.equal(store.load().errors.length, 0);
  assert.equal(readFileSync(original, "utf8"), "Disk version");
  const recovered = store.load().records.find((record) => record.id === a)!;
  assert.equal(recovered.originalPath, original); assert.equal(recovered.revision, file.revision());
  assert.equal(recovered.pending!.body, "Unfinished thought");
  const copy = DocumentFile.fromDraft(recovered.draft);
  assert.equal(copy.path, null); assert.equal(copy.snapshot().text, "Unsaved Alpha");
  store.clear(a); assert.equal(store.load().records[0]!.id, b);
  store.clear(b); assert.equal(store.load().records.length, 0);
});

test("a damaged recovery record does not hide other buffers or get deleted", () => {
  const { folder } = fixture(), store = new RecoveryStore(join(folder, "recovery")), a = randomUUID(), b = randomUUID();
  for (const id of [a, b]) store.save({ id, originalPath: null, revision: null, draft: { text: id, comments: [] } });
  const bad = join(store.directory, `${a}.json`); writeFileSync(bad, "broken");
  assert.equal(store.load().records[0]!.id, b); assert.equal(store.load().errors.length, 1);
  store.clearAll(); assert.equal(readFileSync(bad, "utf8"), "broken");
});
