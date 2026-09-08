import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isNewerVersion, releaseVersion, UpdateChecker, UPDATE_INTERVAL, type ReleaseFetch } from "../src/updates.ts";
import { RELEASES_URL } from "../src/shared/version.ts";

const release = (version = "0.2.0") => ({ tag_name: `v${version}`, draft: false, prerelease: false, html_url: `${RELEASES_URL}/tag/v${version}` });
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "sideleaf-updates-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, "updates.json");
}

test("stable versions compare numerically and reject invalid or preview tags", () => {
  assert.equal(isNewerVersion("v0.10.0", "0.9.9"), true);
  assert.equal(isNewerVersion("1.0.0", "0.99.99"), true);
  for (const candidate of ["v0.1.0", "0.0.9", "0.2.0-beta.1", "0.2", "01.2.3", "999999999999999999.0.0", null]) {
    assert.equal(isNewerVersion(candidate, "0.1.0"), false);
  }
  assert.equal(releaseVersion(release()), "0.2.0");
  for (const invalid of [{ ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), html_url: "https://example.com/download" }, { ...release(), tag_name: "v0.2.0/../../other" }]) {
    assert.throws(() => releaseVersion(invalid));
  }
});

test("automatic checks persist their daily limit and dismissals survive restart", async (t) => {
  const cachePath = fixture(t);
  let now = UPDATE_INTERVAL * 10, calls = 0, version = "0.2.0";
  const request: ReleaseFetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.github.com/repos/kortexa-ai/sideleaf.desktop/releases/latest");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.body, undefined);
    assert.equal(new Headers(options?.headers).has("Authorization"), false);
    assert.equal(new Headers(options?.headers).get("Accept-Encoding"), "identity");
    return new Response(JSON.stringify(release(version)));
  };
  const create = () => new UpdateChecker({ installedVersion: "0.1.0", cachePath, now: () => now, fetch: request, onChange: () => {} });
  const first = create();
  assert.equal((await first.check()).status, "available");
  assert.equal((await first.check()).status, "available");
  assert.equal(calls, 1);
  first.dismiss();
  const second = create();
  assert.equal(second.snapshot().status, "idle");
  assert.equal((await second.check()).status, "idle");
  assert.equal(calls, 1);
  now += UPDATE_INTERVAL;
  await second.check();
  assert.equal(calls, 2);
  assert.equal(second.snapshot().status, "idle");
  now += UPDATE_INTERVAL;
  version = "0.3.0";
  assert.deepEqual(await second.check(), { status: "available", version, url: `${RELEASES_URL}/tag/v${version}` });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(cachePath, "utf8"))).sort(), ["checkedAt", "dismissed", "version"]);
});

test("a manual check joins an automatic request and receives an explicit result", async (t) => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const request: ReleaseFetch = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  const checker = new UpdateChecker({ installedVersion: "0.1.0", cachePath: fixture(t), fetch: request, onChange: () => {} });
  const automatic = checker.check();
  const manual = checker.check(true);
  assert.equal(checker.snapshot().status, "checking");
  finish(new Response(JSON.stringify(release("0.1.0"))));
  assert.deepEqual(await manual, { status: "current" });
  await automatic;
  assert.equal((await checker.check(true)).status, "current");
  assert.equal(calls, 1);
});

test("network and malformed release failures are quiet automatically and visible on demand", async (t) => {
  for (const request of [
    async () => { throw new Error("offline"); },
    async () => new Response("rate limited", { status: 403 }),
    async () => new Response(JSON.stringify({ ...release(), prerelease: true })),
    async () => new Response("x".repeat(1024 * 1024 + 1)),
    async () => new Response("{}", { headers: { "content-length": "2000000" } }),
  ]) {
    const checker = new UpdateChecker({ installedVersion: "0.1.0", cachePath: fixture(t), fetch: request, onChange: () => {} });
    assert.equal((await checker.check()).status, "idle");
    assert.equal((await checker.check(true)).status, "error");
  }
});

test("damaged caches and backwards clocks do not disable future checks", async (t) => {
  const cachePath = fixture(t);
  writeFileSync(cachePath, "invalid JSON");
  let calls = 0, now = UPDATE_INTERVAL * 10;
  const request: ReleaseFetch = async () => { calls++; return new Response(JSON.stringify(release())); };
  const checker = new UpdateChecker({ installedVersion: "0.1.0", cachePath, now: () => now, fetch: request, onChange: () => {} });
  await checker.check();
  now -= UPDATE_INTERVAL;
  await checker.check();
  assert.equal(calls, 2);
});

test("repeated manual checks cannot report an old cached result as current after a failure", async (t) => {
  const cachePath = fixture(t);
  writeFileSync(cachePath, JSON.stringify({ checkedAt: 1, version: "0.1.0" }));
  const checker = new UpdateChecker({ installedVersion: "0.1.0", cachePath, fetch: async () => { throw new Error("offline"); }, onChange: () => {} });
  assert.equal((await checker.check(true)).status, "error");
  assert.equal((await checker.check(true)).status, "error");
});
