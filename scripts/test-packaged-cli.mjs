import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sideleafUserData, startAppChannel } from "../src/collaboration/channel.ts";
const executable = resolve(process.argv[2] ?? (process.platform === "darwin" ? "build/dev-macos-arm64/Sideleaf-dev.app/Contents/MacOS/sideleaf" : "build/dev-win-x64/Sideleaf-dev/bin/sideleaf.exe"));
const env = { ...process.env, PATH: process.platform === "win32" ? `${process.env.SystemRoot}\\System32` : "/usr/bin:/bin" };
const run = (args, input, expected = 0) => {
  const result = spawnSync(executable, args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8", env, timeout: 20_000 });
  assert.equal(result.status, expected, JSON.stringify({ args, status: result.status, stderr: result.stderr, error: result.error }));
  return JSON.parse(result.stdout || result.stderr);
};
const runAsync = (args, childEnv, input) => new Promise((accept, reject) => {
  const child = spawn(executable, args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  child.once("error", reject);
  child.once("close", (status) => accept({ status, stdout, stderr }));
});
const help = spawnSync(executable, ["--help"], { encoding: "utf8", env, timeout: 20_000 });
assert.equal(help.status, 0, JSON.stringify({ stderr: help.stderr, error: help.error })); assert.match(help.stdout, /desktop app supplies the runtime/);
const dir = mkdtempSync(join(tmpdir(), "sideleaf packaged café "));
const file = join(dir, "notes 文 🌿.md"), input = join(dir, "input 文.json");
writeFileSync(file, "\uFEFFHello 🌿 world\r\n");
if (process.platform !== "win32") chmodSync(file, 0o640);
let snapshot = run(["read", file]); assert.equal(snapshot.text, "Hello 🌿 world\n"); const stale = snapshot.revision;
const change = (command, payload, fromFile = false) => {
  const args = [command, file, "--actor", "agent:packaged", "--if-revision", snapshot.revision];
  if (fromFile) { writeFileSync(input, JSON.stringify(payload)); args.push("--input", input); }
  snapshot = run(args, fromFile ? undefined : payload);
};
change("comment-add", { from: 6, to: 8, body: "Preserve 🌿 -->" }); const id = snapshot.comments[0].id;
change("edit", { from: 0, to: 0, text: "Before " }, true);
assert.equal(snapshot.comments[0].anchor.from, 13);
run(["edit", file, "--actor", "agent:stale", "--if-revision", stale], { from: 0, to: 0, text: "stale" }, 3);
change("comment-update", { id, body: "Updated 文" }); assert.equal(run(["comments", file]).comments[0].body, "Updated 文");
change("comment-remove", { id }); assert.equal(snapshot.comments.length, 0);
const added = run(["thread-add", file, "--actor", "agent:packaged", "--if-revision", snapshot.revision], { from: 7, to: 12, body: "Thread root" });
assert.equal(added.saved, true); snapshot = run(["read", file]);
let thread = run(["threads", file]).threads[0], threadGuard = thread.revision;
run(["thread-reply", file, "--actor", "agent:packaged", "--if-thread-revision", threadGuard], { threadId: thread.id, body: "Packaged reply 🌿" });
run(["thread-resolve", file, "--actor", "agent:stale", "--if-thread-revision", threadGuard], { threadId: thread.id }, 3);
snapshot = run(["read", file]); thread = run(["threads", file]).threads[0];
change("comment-update", { id: thread.id, body: "Legacy root update preserves reply" });
thread = run(["threads", file]).threads[0]; assert.equal(thread.messages.length, 2);
run(["comment-remove", file, "--actor", "agent:packaged", "--if-revision", snapshot.revision], { id: thread.id }, 2);
run(["thread-resolve", file, "--actor", "agent:packaged", "--if-thread-revision", thread.revision], { threadId: thread.id });
thread = run(["threads", file]).threads[0]; assert.equal(thread.state, "resolved");
run(["thread-delete", file, "--actor", "agent:packaged", "--if-thread-revision", thread.revision], { threadId: thread.id });
snapshot = run(["read", file]); assert.equal(snapshot.threads.length, 0);
assert.equal(run(["read", file]).text, "Before Hello 🌿 world\n");
if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o640, "The CLI must preserve private file permissions.");
const disk = readFileSync(file, "utf8"); assert.ok(disk.startsWith("\uFEFFBefore Hello 🌿 world\r\n"));
writeFileSync(file + ".sideleaf.lock", "locked");
run(["edit", file, "--actor", "agent:locked", "--if-revision", snapshot.revision], { from: 0, to: 0, text: "lost" }, 3);

const launchHome = mkdtempSync(join(tmpdir(), "sideleaf packaged launch "));
const launchEnv = {
  ...env,
  HOME: launchHome,
  USERPROFILE: launchHome,
  ...(process.platform === "win32" ? { LOCALAPPDATA: join(launchHome, "AppData", "Local") } : {}),
};
const commands = [], documentId = crypto.randomUUID(), instanceId = crypto.randomUUID();
let generation = 2, liveText = "unsaved live";
const liveRevision = () => `sl1.${instanceId}.${documentId}.${generation}`;
const channel = await startAppChannel(sideleafUserData("stable", process.platform, launchEnv), (command) => {
  if (command.kind !== "collaboration") { commands.push(command); return; }
  const operation = command.operation;
  if (operation.kind === "documents") return { contract: "sideleaf-collaboration/v1", documents: [{ id: documentId, path: file, name: "document.md", lineEnding: "\n", notice: null, active: false, dirty: true, generation, revision: liveRevision(), savedRevision: snapshot.revision }] };
  if (operation.kind === "ownership") return { owned: true };
  if (operation.kind === "read") return { owned: true, contract: "sideleaf-collaboration/v1", live: true, saved: false, dirty: true, active: false,
    documentId, path: file, name: "document.md", lineEnding: "\n", notice: null, revision: liveRevision(), savedRevision: snapshot.revision, text: liveText, threads: [], comments: [] };
  if (operation.kind === "apply") { liveText = operation.envelope.operations[0].text; generation++; return { owned: true, contract: "sideleaf-collaboration/v1", live: true,
    saved: false, dirty: true, autoSave: false, documentId, path: file, revision: liveRevision(), savedRevision: snapshot.revision, change: { from: 0, to: 12, inserted: liveText.length } }; }
  return { owned: false };
});
assert.equal(channel.kind, "primary");
try {
  const activated = await runAsync([], launchEnv);
  assert.equal(activated.status, 0, JSON.stringify(activated));
  assert.equal(JSON.parse(activated.stdout).delivery, "running");
  const opened = await runAsync([file], launchEnv);
  assert.equal(opened.status, 0, JSON.stringify(opened));
  assert.equal(JSON.parse(opened.stdout).delivery, "running");
  assert.deepEqual(commands, [{ kind: "activate" }, { kind: "open", path: file }]);
  const listed = await runAsync(["documents"], launchEnv);
  assert.equal(JSON.parse(listed.stdout).documents[0].id, documentId);
  const live = JSON.parse((await runAsync(["read", "--document", documentId], launchEnv)).stdout);
  assert.equal(live.text, "unsaved live");
  const applied = await runAsync(["apply", "--document", documentId, "--if-revision", live.revision, "--actor", "agent:packaged"], launchEnv,
    { operations: [{ kind: "replace", from: 0, to: 12, text: "packaged live" }] });
  assert.equal(JSON.parse(applied.stdout).live, true); assert.equal(liveText, "packaged live");
  const refused = await runAsync(["edit", file, "--if-revision", snapshot.revision, "--actor", "agent:packaged"], launchEnv, { from: 0, to: 0, text: "lost" });
  assert.equal(refused.status, 3); assert.match(JSON.parse(refused.stderr).error, /open in Sideleaf; use apply/);
} finally {
  if (channel.kind === "primary") await channel.close();
}
console.log(`Packaged Cottontail CLI passed headless help, running-instance activation/open, live read/apply ownership, pipes, input files, Unicode, BOM/CRLF, thread lifecycle/guards, legacy comments, revision and lock checks without Node/Bun on PATH: ${executable}`);
