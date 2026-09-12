import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, test } from "node:test";
import { secureWindowsChannelFile } from "../src/platform/windows-channel.ts";
import {
  appChannelPaths,
  APP_CHANNEL_CONTRACT,
  APP_CHANNEL_PROTOCOL,
  deliverAppCommand,
  requestApp,
  sideleafUserData,
  startAppChannel,
  type AppChannel,
  type AppRequest,
} from "../src/collaboration/channel.ts";

const directories: string[] = [];
const channels: AppChannel[] = [];
afterEach(async () => {
  for (const channel of channels.splice(0)) await channel.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function userData(): string {
  const directory = mkdtempSync(join(tmpdir(), "sideleaf-channel-test-"));
  directories.push(directory);
  return directory;
}

function secureTestRecord(path: string) {
  if (process.platform === "win32") secureWindowsChannelFile(path);
  else chmodSync(path, 0o600);
}

test("one primary channel receives exact Unicode open commands and a second app hands off", async () => {
  const root = userData(), received: AppRequest[] = [];
  const started = await startAppChannel(root, async (command) => { received.push(command); });
  assert.equal(started.kind, "primary");
  channels.push(started as AppChannel);

  const path = join(root, "draft café 文 🌿.md");
  const sent = await deliverAppCommand(root, { kind: "open", path });
  assert.equal(sent.delivered, true);
  assert.match(sent.requestId!, /^[a-f0-9-]{36}$/);

  const secondary = await startAppChannel(root, async () => assert.fail("A second app became primary."), { secondaryCommand: { kind: "activate" } });
  assert.deepEqual(secondary, { kind: "delivered" });
  assert.deepEqual(received, [{ kind: "open", path }, { kind: "activate" }]);

  const paths = appChannelPaths(root);
  if (process.platform === "win32") {
    assert.equal(existsSync(paths.owner), true);
    await (started as AppChannel).close();
    assert.equal(existsSync(paths.owner), false);
    const reacquired = await startAppChannel(root, async () => {});
    assert.equal(reacquired.kind, "primary");
    channels.push(reacquired as AppChannel);
  } else {
    assert.equal(statSync(paths.directory).mode & 0o777, 0o700);
    assert.equal(statSync(paths.discovery).mode & 0o777, 0o600);
    const record = JSON.parse(readFileSync(paths.discovery, "utf8"));
    assert.equal(statSync(record.endpoint).mode & 0o777, 0o600);
  }
});

test("the client authenticates the endpoint before sending a token or document path", async () => {
  const root = userData();
  const started = await startAppChannel(root, async () => {});
  assert.equal(started.kind, "primary");
  channels.push(started as AppChannel);
  const paths = appChannelPaths(root);
  const record = JSON.parse(readFileSync(paths.discovery, "utf8"));
  const spoof = process.platform === "win32" ? `${record.endpoint}-spoof` : join(paths.socketDirectory, `spoof-${crypto.randomUUID()}.sock`);
  const received: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => received.push(String(chunk)));
    socket.end(`${JSON.stringify({ contract: record.contract, protocol: record.protocol, type: "hello", instanceId: crypto.randomUUID(), pid: process.pid })}\n`);
  });
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(spoof, accept); });
  if (process.platform !== "win32") chmodSync(spoof, 0o600);
  record.endpoint = spoof;
  writeFileSync(paths.discovery, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(paths.discovery, 0o600);
  try {
    await assert.rejects(deliverAppCommand(root, { kind: "open", path: join(root, "private draft.md") }), /did not match/);
    assert.deepEqual(received, []);
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});

test("a live but unresponsive owner fails closed", async () => {
  const root = userData();
  const started = await startAppChannel(root, async () => {});
  assert.equal(started.kind, "primary");
  channels.push(started as AppChannel);
  const paths = appChannelPaths(root);
  const record = JSON.parse(readFileSync(paths.discovery, "utf8"));
  const hung = process.platform === "win32" ? `${record.endpoint}-hung` : join(paths.socketDirectory, `hung-${crypto.randomUUID()}.sock`);
  const server = createServer(() => {});
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(hung, accept); });
  if (process.platform !== "win32") chmodSync(hung, 0o600);
  record.endpoint = hung;
  writeFileSync(paths.discovery, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(paths.discovery, 0o600);
  try {
    await assert.rejects(deliverAppCommand(root, { kind: "activate" }, { timeoutMs: 80 }), /stale or could not be verified.*did not respond/s);
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});

test("a live PID with a missing endpoint is retryable uncertainty, not absence or ownership", async () => {
  if (process.platform === "win32") return;
  const root = userData(), paths = appChannelPaths(root);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 }); chmodSync(paths.directory, 0o700);
  mkdirSync(paths.socketDirectory, { recursive: true, mode: 0o700 }); chmodSync(paths.socketDirectory, 0o700);
  const endpoint = join(paths.socketDirectory, `${paths.key}-${crypto.randomUUID()}.sock`);
  writeFileSync(paths.discovery, `${JSON.stringify({ contract: APP_CHANNEL_CONTRACT, protocol: APP_CHANNEL_PROTOCOL, instanceId: crypto.randomUUID(), token: crypto.randomUUID(), pid: process.pid,
    startedAt: new Date().toISOString(), processStartedAtMs: Math.round(Date.now() - process.uptime() * 1_000), endpoint })}\n`, { mode: 0o600 });
  chmodSync(paths.discovery, 0o600);
  await assert.rejects(requestApp(root, { kind: "collaboration", operation: { kind: "ownership", target: { path: join(root, "draft.md") } } }),
    (error: unknown) => !!error && typeof error === "object" && (error as { code?: unknown }).code === "UNCERTAIN" &&
      (error as { retryable?: unknown }).retryable === true && !(error as Error).message.includes("owns this app channel"));
});

test("an invalid discovery record fails closed with a request identity", async () => {
  const root = userData(), paths = appChannelPaths(root);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(paths.directory, 0o700);
  writeFileSync(paths.discovery, "not-json\n", { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(paths.discovery, 0o600);
  await assert.rejects(requestApp(root, { kind: "collaboration", operation: { kind: "ownership", target: { path: join(root, "draft.md") } } }),
    (error: unknown) => !!error && typeof error === "object" && (error as { code?: unknown }).code === "UNCERTAIN" &&
      typeof (error as { requestId?: unknown }).requestId === "string" && (error as { retryable?: unknown }).retryable === true);
});

test("a disconnected request after command delivery reports uncertain completion with its request ID", async () => {
  const root = userData();
  const started = await startAppChannel(root, async () => {});
  assert.equal(started.kind, "primary"); channels.push(started as AppChannel);
  const paths = appChannelPaths(root), record = JSON.parse(readFileSync(paths.discovery, "utf8"));
  const endpoint = process.platform === "win32" ? `${record.endpoint}-drop` : join(paths.socketDirectory, `${paths.key}-${crypto.randomUUID()}.sock`);
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write(`${JSON.stringify({ contract: record.contract, protocol: record.protocol, type: "hello", instanceId: record.instanceId, pid: record.pid })}\n`);
    socket.once("data", () => socket.destroy());
  });
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(endpoint, accept); });
  if (process.platform !== "win32") chmodSync(endpoint, 0o600);
  record.endpoint = endpoint; writeFileSync(paths.discovery, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(paths.discovery, 0o600);
  const requestId = crypto.randomUUID();
  try {
    await assert.rejects(requestApp(root, { kind: "collaboration", operation: { kind: "ownership", target: { path: join(root, "draft.md") } } }, { requestId }),
      (error: unknown) => !!error && typeof error === "object" && (error as { requestId?: unknown }).requestId === requestId &&
        (error as { commandSent?: unknown }).commandSent === true && /did not confirm request completion/.test((error as Error).message));
  } finally { await new Promise<void>((accept) => server.close(() => accept())); }
});

test("a new primary removes abandoned sockets in its private namespace", async () => {
  if (process.platform === "win32") return;
  const root = userData(), paths = appChannelPaths(root);
  mkdirSync(paths.socketDirectory, { recursive: true, mode: 0o700 }); chmodSync(paths.socketDirectory, 0o700);
  const stale = join(paths.socketDirectory, `${paths.key}-${crypto.randomUUID()}.sock`);
  const child = spawnSync(process.execPath, ["-e", `const {createServer}=require('node:net');createServer(()=>{}).listen(${JSON.stringify(stale)},()=>process.exit(0))`]);
  assert.equal(child.status, 0, child.stderr.toString()); assert.equal(existsSync(stale), true);
  const started = await startAppChannel(root, async () => {});
  assert.equal(started.kind, "primary"); channels.push(started as AppChannel);
  assert.equal(existsSync(stale), false);
});

test("a dead app record does not block a cold launch even when its socket is gone", async () => {
  const root = userData(), paths = appChannelPaths(root);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(paths.directory, 0o700);
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\sideleaf-${paths.key}-${crypto.randomUUID()}` : join(paths.socketDirectory, `${paths.key}-${crypto.randomUUID()}.sock`);
  writeFileSync(paths.discovery, `${JSON.stringify({ contract: APP_CHANNEL_CONTRACT, protocol: APP_CHANNEL_PROTOCOL, instanceId: crypto.randomUUID(), token: crypto.randomUUID(), pid: 999_999_999,
    startedAt: new Date().toISOString(), processStartedAtMs: 1, endpoint })}\n`, { mode: 0o600 });
  secureTestRecord(paths.discovery);
  assert.deepEqual(await deliverAppCommand(root, { kind: "activate" }), { delivered: false, requestId: null });
});

test("Windows rejects a reused live PID before connecting to a recorded pipe", async () => {
  if (process.platform !== "win32") return;
  const root = userData();
  const started = await startAppChannel(root, async () => {});
  assert.equal(started.kind, "primary");
  const paths = appChannelPaths(root), record = JSON.parse(readFileSync(paths.discovery, "utf8"));
  await (started as AppChannel).close();
  const endpoint = `${record.endpoint}-reused`;
  const received: string[] = [];
  const server = createServer((socket) => socket.on("data", (chunk) => received.push(String(chunk))));
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(endpoint, accept); });
  record.endpoint = endpoint; record.processStartedAtMs++;
  writeFileSync(paths.discovery, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  secureTestRecord(paths.discovery);
  try {
    assert.deepEqual(await deliverAppCommand(root, { kind: "activate" }), { delivered: false, requestId: null });
    assert.deepEqual(received, []);
  } finally { await new Promise<void>((accept) => server.close(() => accept())); }
});

test("app-data roots preserve stable/dev separation", () => {
  assert.equal(sideleafUserData("dev", "darwin", { HOME: "/Users/test" }), "/Users/test/Library/Application Support/ai.kortexa.sideleaf/dev");
  assert.equal(sideleafUserData("stable", "win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }), "C:\\Users\\test\\AppData\\Local\\ai.kortexa.sideleaf\\stable");
});

test("collaboration responses chunk large live snapshots and deduplicate mutation request IDs", async () => {
  const root = userData(); let handled = 0;
  const started = await startAppChannel(root, (request) => {
    handled++;
    assert.equal(request.kind, "collaboration");
    return request.kind === "collaboration" && request.operation.kind === "read" ? { owned: true, text: "🌿".repeat(80_000) } : { owned: true, applied: true };
  });
  assert.equal(started.kind, "primary"); channels.push(started as AppChannel);
  const requestId = crypto.randomUUID(), command = { kind: "collaboration" as const, operation: { kind: "read" as const, target: { path: join(root, "large.md") } } };
  const first = await requestApp<{ owned: boolean; text: string }>(root, command, { requestId });
  assert.equal(first.value?.text, "🌿".repeat(80_000));
  const applyId = crypto.randomUUID(), apply: AppRequest = { kind: "collaboration", operation: { kind: "apply", target: { path: join(root, "large.md") },
    actor: "agent:test", ifRevision: "a".repeat(64), envelope: { operations: [{ kind: "replace", from: 0, to: 0, text: "x" }] }, deadline: Date.now() + 1_000 } };
  const applied = await requestApp<{ owned: boolean; applied: boolean }>(root, apply, { requestId: applyId });
  const replay = await requestApp<{ owned: boolean; applied: boolean }>(root, apply, { requestId: applyId });
  assert.deepEqual(replay.value, applied.value);
  const changed = structuredClone(apply);
  if (changed.operation.kind === "apply" && changed.operation.envelope.operations[0].kind === "replace") changed.operation.envelope.operations[0].text = "y";
  await assert.rejects(requestApp(root, changed, { requestId: applyId }), (error: unknown) => (error as { code?: unknown }).code === "INVALID");
  assert.equal(handled, 2);
});

test("structured busy results retain their request identity and retryable reason", async () => {
  const root = userData();
  const started = await startAppChannel(root, () => { throw Object.assign(new Error("composing"), { code: "BUSY", retryable: true }); });
  assert.equal(started.kind, "primary"); channels.push(started as AppChannel);
  const requestId = crypto.randomUUID();
  await assert.rejects(requestApp(root, { kind: "collaboration", operation: { kind: "ownership", target: { path: join(root, "draft.md") } } }, { requestId }),
    (error: unknown) => !!error && typeof error === "object" && (error as { requestId?: unknown }).requestId === requestId &&
      (error as { code?: unknown }).code === "BUSY" && (error as { retryable?: unknown }).retryable === true);
});
