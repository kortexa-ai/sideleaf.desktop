import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DocumentFile } from "../src/document/files.ts";
import { sideleafUserData, startAppChannel } from "../src/collaboration/channel.ts";
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

test("apply uses the guarded offline evaluator and commits while holding one lock", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sideleaf-cli-apply-")), "a.md"); writeFileSync(path, "Hello 🌿\n");
  const revision = cli(["read", path]).data.revision;
  const applied = cli(["apply", path, "--if-revision", revision, "--actor", "agent:test"],
    { operations: [{ kind: "replace", from: 0, to: 5, text: "Goodbye" }] });
  assert.equal(applied.status, 0, JSON.stringify(applied.data));
  assert.deepEqual({ live: applied.data.live, saved: applied.data.saved, dirty: applied.data.dirty }, { live: false, saved: true, dirty: false });
  assert.equal(DocumentFile.open(path).snapshot().text, "Goodbye 🌿\n");
  const stale = cli(["apply", path, "--if-revision", revision, "--actor", "agent:test"],
    { operations: [{ kind: "replace", from: 0, to: 0, text: "lost" }] });
  assert.equal(stale.status, 3); assert.equal(stale.data.reason, "CONFLICT");
});

test("open-folder requires a directory and file-open keeps its file contract", () => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-cli-folder-")), path = join(folder, "a.md"); writeFileSync(path, "a");
  assert.equal(cli(["open-folder", path]).status, 2);
  assert.match(cli(["open-folder", path]).data.error, /folder path/);
  assert.equal(cli(["open", folder]).status, 2);
  assert.match(cli(["open", folder]).data.error, /open-folder/);
  assert.equal(cli(["open-folder", join(folder, "missing")]).status, 2);
});

test("no arguments activate the running app, a bare file opens it, and help stays headless", async () => {
  const home = mkdtempSync(join(tmpdir(), "sideleaf-cli-launch-"));
  const environment = { ...process.env, HOME: home, ...(process.platform === "win32" ? { LOCALAPPDATA: join(home, "AppData", "Local") } : {}) };
  const userData = sideleafUserData("stable", process.platform, environment);
  const received: unknown[] = [];
  const channel = await startAppChannel(userData, (command) => { received.push(command); });
  assert.equal(channel.kind, "primary");
  const run = (args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((accept) => {
    const child = spawn(process.execPath, [resolve("src/cli.ts"), ...args], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => accept({ status, stdout, stderr }));
  });
  try {
    const activation = await run([]);
    assert.equal(activation.status, 0, activation.stderr);
    assert.equal(JSON.parse(activation.stdout).delivery, "running");
    const path = join(home, "a café 文 🌿.md"); writeFileSync(path, "hello");
    const opened = await run([path]);
    assert.equal(opened.status, 0, opened.stderr);
    assert.deepEqual(JSON.parse(opened.stdout), { ok: true, path, delivery: "running" });
    assert.deepEqual(received, [{ kind: "activate" }, { kind: "open", path }]);

    const helpHome = join(home, "unused-help-home");
    const helpResult = spawnSync(process.execPath, [resolve("src/cli.ts"), "--help"], { encoding: "utf8", env: { ...environment, HOME: helpHome } });
    assert.equal(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, /FILE is shorthand for open FILE/);
    assert.equal(existsSync(join(helpHome, "Library", "Application Support", "ai.kortexa.sideleaf")), false);
  } finally {
    if (channel.kind === "primary") await channel.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("live reads and applies use exact document IDs while legacy mutations refuse owned files", async () => {
  const home = mkdtempSync(join(tmpdir(), "sideleaf-cli-live-"));
  const environment = { ...process.env, HOME: home, ...(process.platform === "win32" ? { LOCALAPPDATA: join(home, "AppData", "Local") } : {}) };
  const path = join(home, "owned.md"); writeFileSync(path, "disk");
  const id = crypto.randomUUID(), instance = crypto.randomUUID(); let generation = 4, text = "unsaved live";
  const revision = () => `sl1.${instance}.${id}.${generation}`;
  const channel = await startAppChannel(sideleafUserData("stable", process.platform, environment), (request) => {
    assert.equal(request.kind, "collaboration");
    const operation = request.kind === "collaboration" ? request.operation : null;
    if (operation?.kind === "documents") return { contract: "sideleaf-collaboration/v1", documents: [{ id, path, name: "owned.md", lineEnding: "\n", notice: null, active: false, dirty: true, generation, revision: revision(), savedRevision: "saved" }] };
    if (operation?.kind === "ownership") return { owned: true };
    if (operation?.kind === "read") return { owned: true, contract: "sideleaf-collaboration/v1", live: true, saved: false, dirty: true, active: false,
      documentId: id, path, name: "owned.md", lineEnding: "\n", notice: null, revision: revision(), savedRevision: "saved", text, comments: [] };
    if (operation?.kind === "apply") {
      assert.equal(operation.ifRevision, revision());
      text = operation.envelope.operations[0].text; generation++;
      return { owned: true, contract: "sideleaf-collaboration/v1", live: true, saved: false, dirty: true, autoSave: false, documentId: id, path,
        revision: revision(), savedRevision: "saved", change: { from: 0, to: 12, inserted: text.length } };
    }
    return { owned: false };
  });
  assert.equal(channel.kind, "primary");
  const run = (args: string[], input?: object) => new Promise<{ status: number | null; data: any }>((accept) => {
    const child = spawn(process.execPath, [resolve("src/cli.ts"), ...args], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.setEncoding("utf8").on("data", (part) => { stdout += part; }); child.stderr.setEncoding("utf8").on("data", (part) => { stderr += part; });
    child.stdin.end(input ? JSON.stringify(input) : undefined);
    child.on("close", (status) => accept({ status, data: JSON.parse(stdout || stderr) }));
  });
  try {
    const documents = await run(["documents"]); assert.equal(documents.status, 0); assert.equal(documents.data.documents[0].id, id);
    const read = await run(["read", "--document", id]); assert.equal(read.data.text, "unsaved live"); assert.equal(read.data.active, false);
    unlinkSync(path);
    const missingDisk = await run(["read", path]); assert.equal(missingDisk.status, 0); assert.equal(missingDisk.data.text, "unsaved live");
    writeFileSync(path, "disk");
    const applied = await run(["apply", "--document", id, "--if-revision", read.data.revision, "--actor", "agent:test"],
      { operations: [{ kind: "replace", from: 0, to: 12, text: "agent live" }] });
    assert.equal(applied.status, 0); assert.equal(applied.data.live, true); assert.equal(text, "agent live");
    const legacy = await run(["edit", path, "--if-revision", "a".repeat(64), "--actor", "agent:test"], { from: 0, to: 0, text: "lost" });
    assert.equal(legacy.status, 3); assert.match(legacy.data.error, /open in Sideleaf; use apply/);
    assert.equal(readFileSync(path, "utf8"), "disk");
  } finally {
    if (channel.kind === "primary") await channel.close();
    rmSync(home, { recursive: true, force: true });
  }
});
