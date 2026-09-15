import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WSL_WRITE_SCRIPT } from "../src/document/wsl-write.ts";

// Exercise the actual shell program on POSIX. Only GNU sync/mv are replaced so
// macOS can run failure injection; native Windows/WSL exercises the real tools.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sideleaf-wsl-write-")), bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "order"), target = join(root, "café '$() ; 葉.md"), temp = join(root, ".private.tmp");
  writeFileSync(target, "original");
  writeFileSync(join(bin, "sync"), '#!/bin/sh\nif [ -d "$3" ]; then step=directory; else step=file; fi\nprintf "%s\\n" "$step" >> "$ORDER"\n[ "$FAIL" != "$step" ]\n', { mode: 0o755 });
  writeFileSync(join(bin, "mv"), '#!/bin/sh\nprintf "rename\\n" >> "$ORDER"\n[ "$FAIL" != rename ] || exit 1\n/bin/mv -f "$3" "$4"\n', { mode: 0o755 });
  const stat = process.platform === "darwin" ? "stat -f %Lp" : "stat -c %a";
  writeFileSync(join(bin, "cat"), `#!/bin/sh\n[ "$(${stat} "$STAGE")" = 600 ] || exit 1\n/bin/cat\n`, { mode: 0o755 });
  const bytes = Buffer.from("\uFEFFcafé 🌿\r\n");
  const run = (fail = "", length = bytes.byteLength) => execFileSync("/bin/sh", ["-c", WSL_WRITE_SCRIPT, "sideleaf-write", target, temp, "640", String(length), root], {
    input: bytes, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, ORDER: log, STAGE: temp, FAIL: fail }, stdio: ["pipe", "pipe", "pipe"],
  });
  return { root, target, temp, bytes, log, run };
}

test("WSL helper preserves raw bytes, mode and sync/rename ordering", { skip: process.platform === "win32" }, () => {
  const f = fixture(); f.run();
  assert.deepEqual(readFileSync(f.target), f.bytes); assert.equal(statSync(f.target).mode & 0o777, 0o640);
  assert.equal(readFileSync(f.log, "utf8"), "file\nrename\ndirectory\n"); assert.equal(existsSync(f.temp), false);
});

test("WSL staging collision and symlink are refused without removing somebody else's file", { skip: process.platform === "win32" }, () => {
  for (const symlink of [false, true]) {
    const f = fixture();
    if (symlink) symlinkSync(f.target, f.temp); else writeFileSync(f.temp, "existing stage");
    assert.throws(() => f.run()); assert.equal(readFileSync(f.target, "utf8"), "original");
    assert.equal(readFileSync(f.temp, "utf8"), symlink ? "original" : "existing stage");
    assert.equal(existsSync(f.log), false);
  }
});

test("WSL short input and failed pre-rename operations leave the original intact", { skip: process.platform === "win32" }, () => {
  for (const fail of ["length", "file", "rename"]) {
    const f = fixture(); assert.throws(() => f.run(fail, f.bytes.length + (fail === "length" ? 1 : 0)));
    assert.equal(readFileSync(f.target, "utf8"), "original"); assert.equal(existsSync(f.temp), false);
  }
});

test("WSL failed directory sync reports failure even after the bytes were replaced", { skip: process.platform === "win32" }, () => {
  const f = fixture(); assert.throws(() => f.run("directory"));
  assert.deepEqual(readFileSync(f.target), f.bytes); assert.equal(existsSync(f.temp), false);
});
