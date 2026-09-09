import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAnchor } from "../src/document/anchors.ts";
import { DocumentFile } from "../src/document/files.ts";
import { ScratchStore } from "../src/document/scratch.ts";

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
  assert.equal(DocumentFile.fromDraft(store.load()!).snapshot().notice, "Restored your untitled draft.");
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
