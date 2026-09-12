import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, test } from "node:test";
import {
  appChannelPaths,
  APP_CHANNEL_CONTRACT,
  APP_CHANNEL_PROTOCOL,
  deliverAppCommand,
  sideleafUserData,
  startAppChannel,
  type AppChannel,
  type AppCommand,
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

test("one primary channel receives exact Unicode open commands and a second app hands off", async () => {
  const root = userData(), received: AppCommand[] = [];
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
  if (process.platform !== "win32") {
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
    await assert.rejects(deliverAppCommand(root, { kind: "activate" }, { timeoutMs: 80 }), /owns this app channel.*did not respond/s);
  } finally {
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});

test("a dead app record does not block a cold launch even when its socket is gone", async () => {
  const root = userData(), paths = appChannelPaths(root);
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(paths.directory, 0o700);
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\sideleaf-${paths.key}-${crypto.randomUUID()}` : join(paths.socketDirectory, `${paths.key}-${crypto.randomUUID()}.sock`);
  writeFileSync(paths.discovery, `${JSON.stringify({ contract: APP_CHANNEL_CONTRACT, protocol: APP_CHANNEL_PROTOCOL, instanceId: crypto.randomUUID(), token: crypto.randomUUID(), pid: 999_999_999, startedAt: new Date().toISOString(), endpoint })}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(paths.discovery, 0o600);
  assert.deepEqual(await deliverAppCommand(root, { kind: "activate" }), { delivered: false, requestId: null });
});

test("app-data roots preserve stable/dev separation", () => {
  assert.equal(sideleafUserData("dev", "darwin", { HOME: "/Users/test" }), "/Users/test/Library/Application Support/ai.kortexa.sideleaf/dev");
  assert.equal(sideleafUserData("stable", "win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }), "C:\\Users\\test\\AppData\\Local\\ai.kortexa.sideleaf\\stable");
});
