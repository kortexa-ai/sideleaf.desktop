import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DocumentFile } from "../src/document/files.ts";
const cli = (args: string[], input?: object) => {
  const result = spawnSync(process.execPath, [resolve("src/cli.ts"), ...args], { input: input ? JSON.stringify(input) : undefined, encoding: "utf8" });
  return { status: result.status, data: JSON.parse(result.stdout || result.stderr) };
};
test("agent read/edit/comment lifecycle, stale actions and dirty GUI conflict", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sideleaf-cli-")), "café 文 🌿.md"); writeFileSync(path, "Hello 🌿 world\n");
  const gui = DocumentFile.open(path); const original = cli(["read", path]); assert.equal(original.status, 0);
  let revision = original.data.revision;
  const write = (command: string, payload: object) => { const result = cli([command, path, "--if-revision", revision, "--actor", "agent:test"], payload); assert.equal(result.status, 0, JSON.stringify(result.data)); revision = result.data.revision; return result.data; };
  const added = write("comment-add", { from: 6, to: 8, body: "Keep the leaf -->" });
  assert.equal(gui.changed(), true); assert.throws(() => gui.save({ text: "dirty GUI", comments: [] }), /changed on disk/);
  assert.equal(cli(["edit", path, "--if-revision", original.data.revision, "--actor", "agent:test"], { from: 0, to: 0, text: "stale" }).status, 3);
  write("edit", { from: 0, to: 0, text: "Before " });
  assert.equal(DocumentFile.open(path).snapshot().comments[0]!.anchor.from, 13);
  write("comment-update", { id: added.comments[0].id, body: "Updated" });
  assert.equal(cli(["comments", path]).data.comments[0].updatedBy, "agent:test");
  write("comment-remove", { id: added.comments[0].id });
  assert.equal(DocumentFile.open(path).snapshot().comments.length, 0);
  assert.equal(DocumentFile.open(path).snapshot().text, "Before Hello 🌿 world\n");
  assert.match(readFileSync(path, "utf8"), /sideleaf:metadata/);
});
test("CLI requires revision/actor and rejects splitting emoji", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sideleaf-cli-")), "a.md"); writeFileSync(path, "🌿");
  assert.equal(cli(["edit", path], {}).status, 2);
  const revision = cli(["read", path]).data.revision;
  assert.equal(cli(["edit", path, "--if-revision", revision, "--actor", "test"], { from: 1, to: 1, text: "x" }).status, 2);
  assert.equal(readFileSync(path, "utf8"), "🌿");
});
