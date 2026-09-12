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
    threads: [{ id: "one", state: "open" as const, anchor: makeAnchor(text, 15, 34), messages: [{ id: "one", body: "Keep this thought", createdAt: "2026-09-09T18:00:00.000Z" }] }],
  };
  store.save(draft);
  assert.deepEqual(store.load(), draft);
  assert.equal(DocumentFile.fromDraft(store.load()!).snapshot().notice, null);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("invalid scratch data is rejected and preserved", () => {
  const { folder, path } = fixture();
  const store = new ScratchStore(path);
  store.save({ text: "safe", threads: [] });
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
  store.save({ text: "temporary", threads: [] });
  store.clear();
  store.clear();
  assert.equal(existsSync(path), false);
  assert.equal(store.load(), null);
});

test("workspace recovery keeps independent named and untitled drafts without modifying originals", () => {
  const { folder } = fixture(), store = new RecoveryStore(join(folder, "recovery"));
  const original = join(folder, "original.md"); writeFileSync(original, "Disk version");
  const file = DocumentFile.open(original), a = randomUUID(), b = randomUUID();
  const draft = { text: "Unsaved Alpha", threads: [] };
  store.save({ id: a, originalPath: original, revision: file.revision(), draft, pending: { comment: { anchor: makeAnchor(draft.text, 0, 7), body: "Unfinished thought", valid: true } } });
  store.save({ id: b, originalPath: null, revision: null, draft: { text: "Untitled Beta", threads: [] } });
  assert.equal(store.load().records.length, 2); assert.equal(store.load().errors.length, 0);
  assert.equal(readFileSync(original, "utf8"), "Disk version");
  const recovered = store.load().records.find((record) => record.id === a)!;
  assert.equal(recovered.originalPath, original); assert.equal(recovered.revision, file.revision());
  assert.equal(recovered.pending!.comment!.body, "Unfinished thought");
  const copy = DocumentFile.fromDraft(recovered.draft);
  assert.equal(copy.path, null); assert.equal(copy.snapshot().text, "Unsaved Alpha");
  store.clear(a); assert.equal(store.load().records[0]!.id, b);
  store.clear(b); assert.equal(store.load().records.length, 0);
});

test("a damaged recovery record does not hide other buffers or get deleted", () => {
  const { folder } = fixture(), store = new RecoveryStore(join(folder, "recovery")), a = randomUUID(), b = randomUUID();
  for (const id of [a, b]) store.save({ id, originalPath: null, revision: null, draft: { text: id, threads: [] } });
  const bad = join(store.directory, `${a}.json`); writeFileSync(bad, "broken");
  assert.equal(store.load().records[0]!.id, b); assert.equal(store.load().errors.length, 1);
  store.clearAll(); assert.equal(readFileSync(bad, "utf8"), "broken");
});

test("v1 scratch and recovery records migrate comments without inventing authors", () => {
  const { folder, path } = fixture(), text = "Legacy note";
  const comment = { id: "legacy", body: "Old thought", createdAt: "2026-09-01", anchor: makeAnchor(text, 0, 6) };
  const store = new ScratchStore(path); store.save({ text, threads: [] });
  writeFileSync(path, JSON.stringify({ format: "sideleaf-scratch", version: 1, savedAt: new Date().toISOString(), draft: { text, comments: [comment] } }));
  const migrated = store.load()!;
  assert.equal(migrated.threads[0]!.id, "legacy"); assert.equal(migrated.threads[0]!.messages[0]!.id, "legacy");
  assert.equal(migrated.threads[0]!.messages[0]!.author, undefined);

  const recovery = new RecoveryStore(join(folder, "recovery")), id = randomUUID();
  recovery.save({ id, originalPath: null, revision: null, draft: { text, threads: [] } });
  writeFileSync(join(recovery.directory, `${id}.json`), JSON.stringify({ format: "sideleaf-recovery", version: 1, id,
    originalPath: null, revision: null, draft: { text, comments: [comment] }, pending: { anchor: comment.anchor, body: "Unfinished root", valid: true } }));
  const restored = recovery.load().records[0]!;
  assert.equal(restored.draft.threads[0]!.messages[0]!.author, undefined);
  assert.equal(restored.pending!.comment!.body, "Unfinished root");
});

test("recovery preserves an unfinished composer after its target disappears", () => {
  const { folder } = fixture(), store = new RecoveryStore(join(folder, "recovery")), id = randomUUID();
  store.save({ id, originalPath: null, revision: null, draft: { text: "Changed", threads: [] }, pending: {
    composer: { kind: "reply", threadId: "removed", body: "Do not lose this reply", baseSemantic: "removed snapshot" },
  } });
  assert.equal(store.load().records[0]!.pending!.composer!.body, "Do not lose this reply");
});
