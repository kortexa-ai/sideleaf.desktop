import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DocumentFile } from "../src/document/files.ts";

// Run with Windows Bun, then bundle and run with the packaged Windows Cottontail.
// An explicit distro is required so this never chooses another user's default.
if (process.platform !== "win32" || !process.argv[2]) throw new Error("Use native Windows: bun scripts/test-wsl-save.ts DISTRO");
const distro = process.argv[2], wsl = join(process.env.SystemRoot ?? "C:\\Windows", "System32/wsl.exe");
const linux = (args: string[]) => execFileSync(wsl, ["--distribution", distro, "--exec", ...args], { encoding: "utf8", windowsHide: true }).trim();
const root = linux(["mktemp", "-d", "/tmp/sideleaf-save-acceptance.XXXXXX"]);
const path = `${root}/café '$() ; 葉.md`, unc = `\\\\wsl.localhost\\${distro}${path.replaceAll("/", "\\")}`;
writeFileSync(unc, Buffer.from("\uFEFFOriginal\r\n")); linux(["chmod", "640", "--", path]);
const file = DocumentFile.open(unc), draft = file.snapshot();
const timings = [];
for (let i = 0; i < 3; i++) {
  draft.text = `Saved ${i} 🌿\n`; const start = performance.now(); file.save(draft); timings.push(Math.round(performance.now() - start));
  assert.equal(linux(["stat", "-c", "%a", "--", path]), "640");
  assert.equal(readFileSync(unc, "utf8"), `\uFEFFSaved ${i} 🌿\r\n`);
}
// Exercise pipe capacity and arbitrary bytes through the bundled runtime too.
draft.text = "A 🌿 leaf\n".repeat(100_000); file.save(draft);
assert.equal(DocumentFile.open(unc).snapshot().text, draft.text);
writeFileSync(unc, "External writer\n");
assert.throws(() => file.save(draft), /changed on disk/);
assert.equal(readFileSync(unc, "utf8"), "External writer\n");
console.log(JSON.stringify({ result: "passed", platform: process.platform, runtime: process.execPath, fixture: root,
  timingsMs: timings, checks: ["unicode-shell-punctuation", "mode-640", "bom-crlf", "large-stdin", "conflict-refusal"] }));
