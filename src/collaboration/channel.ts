import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, win32 } from "node:path";
import { execFileSync } from "node:child_process";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import type { ApplyEnvelope } from "./operations.ts";
import type { CollaborationTarget as DocumentTarget } from "../shared/contracts.ts";

export const APP_CHANNEL_CONTRACT = "sideleaf-app-channel/v1" as const;
export const APP_CHANNEL_PROTOCOL = 1 as const;
const MAX_WIRE_BYTES = 64 * 1024;
const MAX_RESULT_CHARACTERS = 64 * 1024 * 1024;
const RESULT_CHUNK_CHARACTERS = 8_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_WAIT_MS = 120_000;

export type AppCommand =
  | { kind: "activate" }
  | { kind: "open"; path: string }
  | { kind: "open-folder"; path: string };

export type CollaborationOperation =
  | { kind: "documents" }
  | { kind: "ownership" | "read"; target: DocumentTarget }
  | { kind: "apply"; target: DocumentTarget; actor: string; ifRevision: string; envelope: ApplyEnvelope; deadline: number }
  | { kind: "wait"; target: DocumentTarget; after: string; timeoutMs: number };

export type AppRequest = AppCommand | { kind: "collaboration"; operation: CollaborationOperation };
export type AppRequestContext = { requestId: string; deadline: number; signal: AbortSignal };

type EndpointRecord = {
  contract: typeof APP_CHANNEL_CONTRACT;
  protocol: typeof APP_CHANNEL_PROTOCOL;
  instanceId: string;
  token: string;
  pid: number;
  startedAt: string;
  endpoint: string;
};

type ChannelPaths = {
  directory: string;
  discovery: string;
  socketDirectory: string;
  owner: string;
  key: string;
};
type AppResult = { ok: boolean; error?: string; code?: string; retryable?: boolean; value?: unknown };
type CompletedRequest = { fingerprint: string; result: AppResult };

export type AppChannel = {
  kind: "primary";
  instanceId: string;
  close(): Promise<void>;
};

export type AppChannelStart = AppChannel | { kind: "delivered" };
export type AppRequestDelivery<T = unknown> = { delivered: boolean; requestId: string | null; value?: T };
export type AppCommandDelivery = AppRequestDelivery<void>;

export class AppChannelError extends Error {
  constructor(
    message: string,
    readonly requestId: string,
    readonly code = "UNCERTAIN",
    readonly retryable = false,
    readonly commandSent = false,
    readonly responseReceived = false,
  ) { super(message); }
}

function channelKey(userData: string, platform = process.platform): string {
  const canonical = resolve(userData);
  return createHash("sha256").update(platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex").slice(0, 20);
}

export function appChannelPaths(userData: string, platform = process.platform): ChannelPaths {
  const key = channelKey(userData, platform);
  const directory = join(resolve(userData), "cli-channel");
  // Cottontail and the OS both enforce the Unix sockaddr bound. macOS's
  // per-user TMPDIR is long enough to exceed it once a random endpoint is
  // appended, so use the system /tmp namespace inside a private UID folder.
  const temporaryRoot = platform === "darwin" ? "/tmp" : tmpdir();
  const socketDirectory = platform === "win32" ? "" : join(temporaryRoot, `sideleaf-${typeof process.getuid === "function" ? process.getuid() : "user"}`);
  return {
    directory,
    discovery: join(directory, "endpoint.json"),
    socketDirectory,
    owner: platform === "win32" ? `\\\\.\\pipe\\sideleaf-owner-${key}` : join(directory, "owner.lock"),
    key,
  };
}

export function sideleafUserData(channel = "stable", platform = process.platform, environment: NodeJS.ProcessEnv = process.env): string {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(channel)) throw new Error("Invalid Sideleaf app channel.");
  if (platform === "darwin") return posix.join(environment.HOME ?? homedir(), "Library", "Application Support", "ai.kortexa.sideleaf", channel);
  if (platform === "win32") return win32.join(environment.LOCALAPPDATA ?? win32.join(environment.USERPROFILE ?? homedir(), "AppData", "Local"), "ai.kortexa.sideleaf", channel);
  return posix.join(environment.XDG_DATA_HOME ?? posix.join(environment.HOME ?? homedir(), ".local", "share"), "ai.kortexa.sideleaf", channel);
}

function ensurePrivateDirectory(path: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Unsafe Sideleaf channel directory: ${path}`);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    chmodSync(path, 0o700);
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
      throw new Error(`Sideleaf channel directory is not private to this user: ${path}`);
    }
  }
}

function assertPrivateDirectory(path: string) {
  if (process.platform === "win32") return;
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) {
    throw new Error(`Sideleaf channel directory is not private to this user: ${path}`);
  }
}

function atomicPrivateWrite(path: string, contents: string) {
  const temp = join(dirname(path), `.endpoint-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
    if (process.platform !== "win32") chmodSync(temp, 0o600);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function processState(pid: number): "live" | "dead" | "unknown" {
  try { process.kill(pid, 0); return "live"; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    return "unknown";
  }
}

function validEndpoint(record: unknown, paths: ChannelPaths, platform = process.platform): record is EndpointRecord {
  if (!record || typeof record !== "object") return false;
  const value = record as Partial<EndpointRecord>;
  const endpoint = value.endpoint;
  const endpointValid = platform === "win32"
    ? typeof endpoint === "string" && endpoint.startsWith(`\\\\.\\pipe\\sideleaf-${paths.key}-`)
    : typeof endpoint === "string" && dirname(endpoint) === paths.socketDirectory;
  return value.contract === APP_CHANNEL_CONTRACT && value.protocol === APP_CHANNEL_PROTOCOL &&
    typeof value.instanceId === "string" && /^[a-f0-9-]{36}$/.test(value.instanceId) &&
    typeof value.token === "string" && /^[a-f0-9-]{36}$/.test(value.token) &&
    Number.isSafeInteger(value.pid) && value.pid! > 0 &&
    typeof value.startedAt === "string" && value.startedAt.length <= 40 && endpointValid;
}

function readEndpoint(paths: ChannelPaths): EndpointRecord | null {
  let stat;
  try { stat = lstatSync(paths.discovery); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  assertPrivateDirectory(paths.directory);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8_192) throw new Error("Sideleaf's app endpoint record is unsafe.");
  if (process.platform !== "win32" && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)) {
    throw new Error("Sideleaf's app endpoint record is not private to this user.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(paths.discovery, "utf8")); }
  catch { throw new Error("Sideleaf's app endpoint record is invalid."); }
  if (!validEndpoint(parsed, paths)) throw new Error("Sideleaf's app endpoint record is incompatible.");
  return parsed;
}

function assertPrivateEndpoint(record: EndpointRecord, paths: ChannelPaths) {
  if (process.platform !== "win32") {
    assertPrivateDirectory(paths.socketDirectory);
    const socket = lstatSync(record.endpoint);
    if (!socket.isSocket() || socket.isSymbolicLink() || socket.uid !== process.getuid!() || (socket.mode & 0o077) !== 0) {
      throw new Error("Sideleaf's app endpoint socket is not private to this user.");
    }
  }
}

function validateTarget(value: unknown): asserts value is DocumentTarget {
  if (!value || typeof value !== "object") throw new Error("Invalid collaboration target.");
  const target = value as { path?: unknown; documentId?: unknown };
  const path = typeof target.path === "string" ? target.path : null;
  const documentId = typeof target.documentId === "string" ? target.documentId : null;
  if (!!path === !!documentId || (path && (path.length > 32_768 || !isAbsolute(path) || path.includes("\0"))) ||
    (documentId && !/^[a-f0-9-]{36}$/.test(documentId))) throw new Error("Invalid collaboration target.");
}

function validateCommand(value: unknown): asserts value is AppRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid app command.");
  const command = value as Partial<AppRequest>;
  if (command.kind === "activate") return;
  if (command.kind === "collaboration") {
    const operation = (command as { operation?: Partial<CollaborationOperation> }).operation;
    if (!operation || typeof operation !== "object") throw new Error("Invalid collaboration request.");
    if (operation.kind === "documents") return;
    if (operation.kind !== "ownership" && operation.kind !== "read" && operation.kind !== "apply" && operation.kind !== "wait") throw new Error("Invalid collaboration request.");
    validateTarget(operation.target);
    if (operation.kind === "apply" && (typeof operation.actor !== "string" || !operation.actor.trim() || operation.actor.length > 200 ||
      typeof operation.ifRevision !== "string" || operation.ifRevision.length > 200 || !Number.isSafeInteger(operation.deadline))) throw new Error("Invalid collaboration apply request.");
    if (operation.kind === "wait" && (typeof operation.after !== "string" || operation.after.length > 200 || typeof operation.timeoutMs !== "number" || !Number.isSafeInteger(operation.timeoutMs) || operation.timeoutMs < 1 || operation.timeoutMs > MAX_WAIT_MS)) {
      throw new Error("Invalid collaboration wait request.");
    }
    return;
  }
  if ((command.kind !== "open" && command.kind !== "open-folder") || typeof command.path !== "string" ||
    !command.path || command.path.length > 32_768 || !isAbsolute(command.path) || command.path.includes("\0")) {
    throw new Error("Invalid app open command.");
  }
}

function writeWire(socket: Socket, value: unknown) {
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line) > MAX_WIRE_BYTES) throw new Error("Sideleaf app request is too large.");
  socket.write(line);
}

async function writeResult(socket: Socket, base: AppResult, requestId: string | null, instanceId: string) {
  const direct = { ...base, type: "result", requestId, instanceId };
  const serialized = JSON.stringify(direct);
  if (Buffer.byteLength(`${serialized}\n`) <= MAX_WIRE_BYTES) { writeWire(socket, direct); return; }
  if (serialized.length > MAX_RESULT_CHARACTERS) throw new Error("Sideleaf app result is too large.");
  const chunks = Math.ceil(serialized.length / RESULT_CHUNK_CHARACTERS);
  writeWire(socket, { type: "result-start", requestId, instanceId, chunks });
  for (let index = 0; index < chunks; index++) {
    const frame = { type: "result-chunk", requestId, instanceId, index, text: serialized.slice(index * RESULT_CHUNK_CHARACTERS, (index + 1) * RESULT_CHUNK_CHARACTERS) };
    const line = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(line) > MAX_WIRE_BYTES) throw new Error("Sideleaf app result chunk is too large.");
    if (!socket.write(line)) await new Promise<void>((accept, reject) => { socket.once("drain", accept); socket.once("error", reject); });
  }
  writeWire(socket, { type: "result-end", requestId, instanceId, chunks });
}

function errorFields(error: unknown): { ok: false; error: string; code?: string; retryable?: boolean } {
  const value = error as { message?: unknown; code?: unknown; retryable?: unknown };
  return { ok: false, error: typeof value?.message === "string" ? value.message : String(error),
    ...(typeof value?.code === "string" ? { code: value.code } : {}), ...(typeof value?.retryable === "boolean" ? { retryable: value.retryable } : {}) };
}

function serveConnection(socket: Socket, record: EndpointRecord, handler: (command: AppRequest, context: AppRequestContext) => unknown | Promise<unknown>, completed: Map<string, CompletedRequest>) {
  socket.setEncoding("utf8");
  socket.on("error", () => { /* Invalid or cancelled clients cannot affect the app. */ });
  socket.setTimeout(DEFAULT_TIMEOUT_MS, () => socket.destroy(new Error("Sideleaf app request timed out.")));
  const controller = new AbortController();
  socket.once("close", () => controller.abort());
  let buffer = "";
  writeWire(socket, { contract: APP_CHANNEL_CONTRACT, protocol: APP_CHANNEL_PROTOCOL, type: "hello", instanceId: record.instanceId, pid: record.pid });
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_WIRE_BYTES) { socket.destroy(new Error("Sideleaf app request is too large.")); return; }
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    void (async () => {
      let request: { type?: unknown; requestId?: unknown; instanceId?: unknown; token?: unknown; command?: unknown };
      try { request = JSON.parse(line); }
      catch { throw new Error("Invalid Sideleaf app request."); }
      if (request.type !== "command" || typeof request.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(request.requestId) ||
        request.instanceId !== record.instanceId || typeof request.token !== "string" || !constantEqual(request.token, record.token)) {
        throw new Error("Sideleaf app request authentication failed.");
      }
      validateCommand(request.command);
      const command = request.command;
      const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
      const prior = completed.get(request.requestId);
      if (prior) {
        const result = prior.fingerprint === fingerprint ? prior.result : { ok: false, error: "This request ID was already used for a different command.", code: "INVALID" };
        await writeResult(socket, result, request.requestId, record.instanceId); socket.end(); return;
      }
      const waitMs = command.kind === "collaboration" && command.operation.kind === "wait" ? command.operation.timeoutMs : DEFAULT_TIMEOUT_MS;
      socket.setTimeout(Math.min(MAX_WAIT_MS, waitMs) + 1_000);
      const deadline = command.kind === "collaboration" && command.operation.kind === "apply" ? command.operation.deadline : Date.now() + waitMs;
      let result: AppResult;
      try { result = { ok: true, value: await handler(command, { requestId: request.requestId, deadline, signal: controller.signal }) }; }
      catch (error) { result = errorFields(error); }
      const resultSize = Buffer.byteLength(JSON.stringify(result));
      if (resultSize <= 256 * 1024) completed.set(request.requestId, { fingerprint, result });
      while (completed.size > 256) completed.delete(completed.keys().next().value!);
      await writeResult(socket, result, request.requestId, record.instanceId);
      socket.end();
    })().catch((error) => {
      void writeResult(socket, errorFields(error), null, record.instanceId).finally(() => socket.end());
    });
  });
}

async function listen(server: Server, endpoint: string): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const error = (value: Error) => { server.off("listening", ready); reject(value); };
    const ready = () => { server.off("error", error); accept(); };
    server.once("error", error); server.once("listening", ready); server.listen(endpoint);
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((accept) => server.close(() => accept()));
}

async function acquireOwner(paths: ChannelPaths): Promise<{ owned: boolean; server: Server | null }> {
  if (process.platform === "darwin") {
    try {
      execFileSync("/usr/bin/shlock", ["-p", String(process.pid), "-f", paths.owner], { stdio: "ignore" });
      return { owned: true, server: null };
    } catch { return { owned: false, server: null }; }
  }
  const server = createServer((socket) => socket.end());
  try { await listen(server, paths.owner); return { owned: true, server }; }
  catch (error) {
    server.close();
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return { owned: false, server: null };
    throw error;
  }
}

function sweepStaleSockets(paths: ChannelPaths) {
  if (process.platform === "win32") return;
  const prefix = `${paths.key}-`;
  for (const entry of readdirSync(paths.socketDirectory)) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".sock")) continue;
    const path = join(paths.socketDirectory, entry);
    try {
      const stat = lstatSync(path);
      if (stat.isSocket() && !stat.isSymbolicLink() && stat.uid === process.getuid!()) unlinkSync(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

async function exchange<T>(record: EndpointRecord, command: AppRequest, timeoutMs: number, suppliedRequestId?: string): Promise<{ requestId: string; value: T }> {
  const requestId = suppliedRequestId ?? randomUUID();
  return new Promise<{ requestId: string; value: T }>((accept, reject) => {
    const socket = createConnection(record.endpoint);
    socket.setEncoding("utf8");
    const timer = setTimeout(() => socket.destroy(new Error("The running Sideleaf app did not respond in time.")), timeoutMs);
    let buffer = "", authenticated = false, commandSent = false, settled = false, resultChunks: string[] | null = null, expectedChunks = 0, resultCharacters = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) {
        const value = error instanceof AppChannelError ? error : new AppChannelError(error.message, requestId);
        reject(new AppChannelError(value.message, value.requestId, value.code, value.retryable, commandSent || value.commandSent, value.responseReceived));
      }
    };
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("The running Sideleaf app closed the connection without a result.")));
    socket.on("close", () => finish(new Error("The running Sideleaf app closed the connection without a result.")));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_WIRE_BYTES) { finish(new Error("The running Sideleaf app sent an oversized response.")); return; }
        let response: Record<string, unknown>;
        try { response = JSON.parse(line); }
        catch { finish(new Error("The running Sideleaf app sent an invalid response.")); return; }
        if (!authenticated) {
          if (response.contract !== APP_CHANNEL_CONTRACT || response.protocol !== APP_CHANNEL_PROTOCOL || response.type !== "hello" ||
            response.instanceId !== record.instanceId || response.pid !== record.pid) {
            finish(new Error("The Sideleaf endpoint did not match the running app.")); return;
          }
          authenticated = true;
          writeWire(socket, { type: "command", requestId, instanceId: record.instanceId, token: record.token, command });
          commandSent = true;
        } else if (response.type === "result-start") {
          if (resultChunks || response.requestId !== requestId || response.instanceId !== record.instanceId || !Number.isSafeInteger(response.chunks) || (response.chunks as number) < 1 || (response.chunks as number) > 10_000) {
            finish(new AppChannelError("The running Sideleaf app sent an invalid chunk header.", requestId)); return;
          }
          expectedChunks = response.chunks as number; resultChunks = []; resultCharacters = 0;
        } else if (response.type === "result-chunk") {
          if (!resultChunks || response.requestId !== requestId || response.instanceId !== record.instanceId || response.index !== resultChunks.length || typeof response.text !== "string" || response.text.length > RESULT_CHUNK_CHARACTERS) {
            finish(new AppChannelError("The running Sideleaf app sent an invalid result chunk.", requestId)); return;
          }
          resultChunks.push(response.text); resultCharacters += response.text.length;
          if (resultCharacters > MAX_RESULT_CHARACTERS) { finish(new AppChannelError("The running Sideleaf app sent an oversized result.", requestId)); return; }
        } else if (response.type === "result-end") {
          if (!resultChunks || resultChunks.length !== expectedChunks || response.chunks !== expectedChunks) { finish(new AppChannelError("The running Sideleaf app ended an incomplete result.", requestId)); return; }
          try { response = JSON.parse(resultChunks.join("")); } catch { finish(new AppChannelError("The running Sideleaf app sent an invalid chunked result.", requestId)); return; }
          resultChunks = null;
          if (response.type !== "result") { finish(new AppChannelError("The running Sideleaf app sent an invalid result.", requestId)); return; }
        } else if (response.type !== "result") {
          finish(new AppChannelError("The running Sideleaf app sent an invalid result.", requestId)); return;
        }
        if (response.type === "result") {
          if (response.requestId !== requestId || response.instanceId !== record.instanceId || typeof response.ok !== "boolean") {
            finish(new AppChannelError("The running Sideleaf app sent an invalid result.", requestId)); return;
          }
          if (!response.ok) finish(new AppChannelError(typeof response.error === "string" ? response.error : "The running Sideleaf app rejected the request.", requestId,
            typeof response.code === "string" ? response.code : "REJECTED", response.retryable === true, true, true));
          else { settled = true; clearTimeout(timer); socket.end(); accept({ requestId, value: response.value as T }); }
        }
      }
      if (Buffer.byteLength(buffer) > MAX_WIRE_BYTES) finish(new Error("The running Sideleaf app sent an oversized response."));
    });
  });
}

export async function requestApp<T = unknown>(userData: string, command: AppRequest, options: { timeoutMs?: number; requestId?: string } = {}): Promise<AppRequestDelivery<T>> {
  validateCommand(command);
  const paths = appChannelPaths(userData);
  const requestId = options.requestId ?? randomUUID();
  let record: EndpointRecord | null;
  try { record = readEndpoint(paths); }
  catch (error) {
    throw new AppChannelError(`Sideleaf's endpoint record is stale or could not be verified. Retry after it is republished: ${(error as Error).message}`, requestId, "UNCERTAIN", true);
  }
  if (!record || processState(record.pid) === "dead") return { delivered: false, requestId: null };
  try {
    assertPrivateEndpoint(record, paths);
    const result = await exchange<T>(record, command, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, requestId);
    return { delivered: true, requestId: result.requestId, value: result.value };
  }
  catch (error) {
    const value = error instanceof AppChannelError ? error : new AppChannelError((error as Error).message, requestId);
    if (value.responseReceived) throw value;
    if (!value.commandSent && processState(record.pid) === "dead") return { delivered: false, requestId: null };
    const message = value.commandSent
      ? `Sideleaf did not confirm request completion. Reconcile with request ${requestId} before retrying: ${value.message}`
      : `Sideleaf's endpoint record is stale or could not be verified. Retry after the owning process exits or republishes it: ${value.message}`;
    throw new AppChannelError(message, requestId, "UNCERTAIN", true, value.commandSent, false);
  }
}

export async function deliverAppCommand(userData: string, command: AppCommand, options: { timeoutMs?: number; requestId?: string } = {}): Promise<AppCommandDelivery> {
  const result = await requestApp<void>(userData, command, options);
  return { delivered: result.delivered, requestId: result.requestId };
}

async function deliverWithStartupWait(userData: string, command: AppCommand, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const requestId = randomUUID();
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const result = await deliverAppCommand(userData, command, { timeoutMs: Math.min(1_000, Math.max(100, deadline - Date.now())), requestId });
      if (result.delivered) return;
    } catch (error) { lastError = error as Error; }
    await new Promise((accept) => setTimeout(accept, 50));
  }
  throw lastError ?? new Error("Another Sideleaf process owns this app channel but did not publish a usable endpoint.");
}

export async function startAppChannel(userData: string, handler: (command: AppRequest, context: AppRequestContext) => unknown | Promise<unknown>, options: { secondaryCommand?: AppCommand; timeoutMs?: number } = {}): Promise<AppChannelStart> {
  const paths = appChannelPaths(userData);
  ensurePrivateDirectory(paths.directory);
  if (process.platform !== "win32") ensurePrivateDirectory(paths.socketDirectory);
  const owner = await acquireOwner(paths);
  if (!owner.owned) {
    await deliverWithStartupWait(userData, options.secondaryCommand ?? { kind: "activate" }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return { kind: "delivered" };
  }
  sweepStaleSockets(paths);

  const instanceId = randomUUID(), token = randomUUID();
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\sideleaf-${paths.key}-${instanceId}`
    : join(paths.socketDirectory, `${paths.key}-${instanceId}.sock`);
  const record: EndpointRecord = { contract: APP_CHANNEL_CONTRACT, protocol: APP_CHANNEL_PROTOCOL, instanceId, token, pid: process.pid, startedAt: new Date().toISOString(), endpoint };
  const serialized = `${JSON.stringify(record)}\n`;
  const completed = new Map<string, CompletedRequest>();
  const server = createServer((socket) => serveConnection(socket, record, handler, completed));
  let closed = false;
  const cleanupFiles = () => {
    try { if (readFileSync(paths.discovery, "utf8") === serialized) unlinkSync(paths.discovery); } catch { /* A missing or replaced record is not ours. */ }
    if (process.platform === "darwin") {
      try { if (readFileSync(paths.owner, "utf8").trim() === String(process.pid)) unlinkSync(paths.owner); } catch { /* A missing or replaced owner is not ours. */ }
    }
    if (process.platform !== "win32") {
      try { unlinkSync(endpoint); } catch { /* Closing a Unix server normally removes its socket. */ }
    }
  };
  try {
    await listen(server, endpoint);
    if (process.platform !== "win32") chmodSync(endpoint, 0o600);
    atomicPrivateWrite(paths.discovery, serialized);
  } catch (error) {
    await closeServer(server); await closeServer(owner.server); cleanupFiles(); throw error;
  }
  process.once("exit", cleanupFiles);
  return {
    kind: "primary",
    instanceId,
    async close() {
      if (closed) return;
      closed = true; process.off("exit", cleanupFiles);
      await closeServer(server); await closeServer(owner.server); cleanupFiles();
    },
  };
}
