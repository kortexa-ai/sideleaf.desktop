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
const runAsync = (args, childEnv) => new Promise((accept, reject) => {
  const child = spawn(executable, args, { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
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
const commands = [];
const channel = await startAppChannel(sideleafUserData("stable", process.platform, launchEnv), (command) => { commands.push(command); });
assert.equal(channel.kind, "primary");
try {
  const activated = await runAsync([], launchEnv);
  assert.equal(activated.status, 0, JSON.stringify(activated));
  assert.equal(JSON.parse(activated.stdout).delivery, "running");
  const opened = await runAsync([file], launchEnv);
  assert.equal(opened.status, 0, JSON.stringify(opened));
  assert.equal(JSON.parse(opened.stdout).delivery, "running");
  assert.deepEqual(commands, [{ kind: "activate" }, { kind: "open", path: file }]);
} finally {
  if (channel.kind === "primary") await channel.close();
}
console.log(`Packaged Cottontail CLI passed headless help, running-instance activation/open, pipes, input files, Unicode, BOM/CRLF, comments, revision and lock checks without Node/Bun on PATH: ${executable}`);
