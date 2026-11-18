import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverZiblet, runCommand, ZIBLET_BUNDLE_ID, type CommandResult } from "../src/platform/ziblet.ts";

const app = "/Applications/Ziblet.app\n";
// Answers osascript and defaults in order, recording each call.
function fakeRun(lookup: CommandResult | Error, preference: CommandResult | Error) {
  const calls: string[][] = [];
  const run = async (executable: string, args: string[]) => {
    calls.push([executable, ...args]);
    const answer = executable === "/usr/bin/osascript" ? lookup : preference;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, run };
}
function withHome(body: (home: string, folder: string) => Promise<void>) {
  return async () => {
    const home = mkdtempSync(join(tmpdir(), "sideleaf-ziblet-"));
    try { await body(home, join(home, "kortexa", "ziblet")); } finally { rmSync(home, { recursive: true, force: true }); }
  };
}

test("Ziblet discovery is off outside macOS and runs no command", async () => {
  for (const platform of ["win32", "linux"] as const) {
    const fake = fakeRun({ code: 0, stdout: app }, { code: 0, stdout: "/notes\n" });
    assert.equal(await discoverZiblet({ platform, run: fake.run }), null);
    assert.deepEqual(fake.calls, []);
  }
});

test("Ziblet discovery asks Launch Services by bundle identifier and stops when the app is missing", withHome(async (home, folder) => {
  mkdirSync(folder, { recursive: true });
  const missing = fakeRun({ code: 0, stdout: "\n" }, { code: 0, stdout: `${folder}\n` });
  assert.equal(await discoverZiblet({ platform: "darwin", home: () => home, run: missing.run }), null);
  assert.equal(missing.calls.length, 1);
  const [executable, ...args] = missing.calls[0]!;
  assert.equal(executable, "/usr/bin/osascript");
  assert.deepEqual(args.slice(0, 3), ["-l", "JavaScript", "-e"]);
  assert.match(args[3]!, /ObjC\.import\("AppKit"\).*NSWorkspace\.sharedWorkspace\.URLForApplicationWithBundleIdentifier\("ai\.kortexa\.ziblet\.osx"\)/);
  assert.match(args[3]!, /isNil\(\)/);
}));

test("Ziblet discovery uses an absolute dataFolder preference", withHome(async (home) => {
  const custom = join(home, "Ziblet notes café"); mkdirSync(custom);
  const fake = fakeRun({ code: 0, stdout: app }, { code: 0, stdout: `${custom}\n` });
  assert.deepEqual(await discoverZiblet({ platform: "darwin", home: () => home, run: fake.run }), { folder: custom });
  assert.deepEqual(fake.calls[1], ["/usr/bin/defaults", "read", ZIBLET_BUNDLE_ID, "dataFolder"]);
}));

test("Ziblet discovery falls back to the default folder for an absent, empty or relative preference", withHome(async (home, folder) => {
  mkdirSync(folder, { recursive: true });
  for (const preference of [{ code: 1, stdout: "" }, { code: 0, stdout: "\n" }, { code: 0, stdout: "notes/ziblet\n" }, { code: 0, stdout: "~/notes\n" }]) {
    const fake = fakeRun({ code: 0, stdout: app }, preference);
    assert.deepEqual(await discoverZiblet({ platform: "darwin", home: () => home, run: fake.run }), { folder });
  }
}));

test("Ziblet discovery requires the folder to exist as a directory", withHome(async (home, folder) => {
  const run = fakeRun({ code: 0, stdout: app }, { code: 1, stdout: "" }).run;
  assert.equal(await discoverZiblet({ platform: "darwin", home: () => home, run }), null);
  mkdirSync(join(home, "kortexa")); writeFileSync(folder, "not a folder");
  assert.equal(await discoverZiblet({ platform: "darwin", home: () => home, run }), null);
}));

test("Ziblet discovery gives null when a command fails or times out", withHome(async (home, folder) => {
  mkdirSync(folder, { recursive: true });
  for (const [lookup, preference] of [[new Error("timed out"), { code: 0, stdout: "" }], [{ code: 1, stdout: app }, { code: 0, stdout: "" }],
    [{ code: 0, stdout: app }, new Error("timed out")]] as const) {
    assert.equal(await discoverZiblet({ platform: "darwin", home: () => home, run: fakeRun(lookup, preference).run }), null);
  }
  const started = Date.now();
  await assert.rejects(runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], 200), /timed out/);
  assert.ok(Date.now() - started < 5_000);
  assert.deepEqual(await runCommand(process.execPath, ["-e", "process.stdout.write('ok'); process.exit(3)"]), { code: 3, stdout: "ok" });
}));
