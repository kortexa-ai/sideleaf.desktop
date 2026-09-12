import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { shellQuote, appleScriptString, defaultWSLDistro } from "../src/platform/cli-install.ts";

test("installation paths survive shell and AppleScript string boundaries", { skip: process.platform === "win32" }, () => {
  const value = '/Applications/Franci\'s "Sideleaf" $(false) `false` 文.app';
  const result = spawnSync("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`], { encoding: "utf8" });
  assert.equal(result.status, 0); assert.equal(result.stdout, value);
  assert.equal(appleScriptString('a"b\\c'), '"a\\"b\\\\c"');
});
test("WSL installation is unavailable outside Windows", { skip: process.platform === "win32" }, async () => {
  assert.equal(await defaultWSLDistro(), null);
});
test("the WSL wrapper translates collaboration document operands and execs the Windows CLI", () => {
  const source = readFileSync(new URL("../src/platform/install-cli-wsl.sh", import.meta.url), "utf8");
  assert.match(source, /read\|comments\|apply\|wait\|edit/);
  assert.match(source, /\$\{args\[1\]\} != -\*/);
  assert.match(source, /""\|documents\|skills/);
  assert.match(source, /exec "\$launcher" "\$\{args\[@\]\}"/);
});
