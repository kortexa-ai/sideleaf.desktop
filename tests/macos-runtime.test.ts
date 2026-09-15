import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("macOS GUI and CLI set private runtime scratch before exec, preserving cwd and arguments", { skip: process.platform !== "darwin" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "sideleaf launcher café "));
  const probe = `#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\nint main(int argc,char **argv){char cwd[4096]; puts(getenv("COTTONTAIL_TMP_DIR")); puts(getcwd(cwd,sizeof(cwd))); for(int i=1;i<argc;i++) puts(argv[i]);}`;
  execFileSync("xcrun", ["clang", "-x", "c", "-", "-o", join(directory, "electrobun-launcher")], { input: probe });
  copyFileSync(join(directory, "electrobun-launcher"), join(directory, "cottontail"));
  for (const [source, name, cli] of [["sideleaf-launcher", "launcher", false], ["sideleaf", "sideleaf", true]] as const) {
    copyFileSync(resolve("dist/native", source), join(directory, name));
    const lines = execFileSync(join(directory, name), ["relative café.md", "--example"], {
      cwd: directory, encoding: "utf8", env: { ...process.env, COTTONTAIL_TMP_DIR: directory, TMPDIR: directory },
    }).trim().split("\n");
    const scratch = lines.shift()!;
    assert.notEqual(scratch, directory);
    assert.ok(scratch.endsWith("/ai.kortexa.sideleaf-runtime"));
    const info = statSync(scratch);
    assert.equal(info.mode & 0o777, 0o700); assert.equal(info.uid, process.getuid!());
    assert.equal(lines.shift(), realpathSync(directory));
    if (cli) assert.ok(lines.shift()!.endsWith("/../Resources/app/cli/sideleaf.mjs"));
    assert.deepEqual(lines, ["relative café.md", "--example"]);
    assert.equal(existsSync(join(directory, ".cottontail-tmp")), false);
  }
});
