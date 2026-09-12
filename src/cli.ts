import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { acquireDocumentLockAsync, DocumentFile, type DocumentLock } from "./document/files.ts";
import { makeAnchor } from "./document/anchors.ts";
import { legacyComments, MAX_DOCUMENT_BYTES, type ReviewThread } from "./shared/contracts.ts";
import { installSideleafSkills, parseSkillInstallArgs } from "./skill.ts";
import { AppChannelError, deliverAppCommand, requestApp, sideleafUserData, type AppCommand, type CollaborationOperation } from "./collaboration/channel.ts";
import { diffDraftActivity, fileCursor, matchesActivity, publicActivity } from "./collaboration/activity.ts";
import { COLLABORATION_CONTRACT, CollaborationError, evaluateApply, focusDraft, parseApplyEnvelope, requiresDocumentRevision, threadRevision, type DocumentTarget } from "./collaboration/operations.ts";

const help = `sideleaf — local Markdown and comments (JSON output)

sideleaf [--app PATH]
sideleaf FILE [--app PATH]
sideleaf read FILE
sideleaf read --document ID [--app PATH]
sideleaf comments FILE
sideleaf threads FILE
sideleaf documents [--app PATH]
sideleaf focus FILE < focus.json
sideleaf apply FILE --actor NAME < apply.json
sideleaf wait FILE --after CURSOR [--actor NAME] [--thread ID] [--mention TEXT] [--timeout SECONDS]
sideleaf edit FILE --if-revision HASH --actor NAME < edit.json
sideleaf comment-add FILE --if-revision HASH --actor NAME < comment.json
sideleaf comment-update FILE --if-revision HASH --actor NAME < update.json
sideleaf comment-remove FILE --if-revision HASH --actor NAME < remove.json
sideleaf thread-add FILE --if-revision REV --actor NAME < thread.json
sideleaf thread-reply FILE --if-thread-revision REV --actor NAME < reply.json
sideleaf thread-message-update FILE --if-thread-revision REV --actor NAME < message.json
sideleaf thread-message-delete FILE --if-thread-revision REV --actor NAME < message.json
sideleaf thread-resolve FILE --if-thread-revision REV --actor NAME < thread-id.json
sideleaf thread-reopen FILE --if-thread-revision REV --actor NAME < thread-id.json
sideleaf thread-delete FILE --if-thread-revision REV --actor NAME < thread-id.json
sideleaf suggestion-add FILE --actor NAME < suggestion.json
sideleaf suggestion-accept FILE --if-thread-revision REV --actor NAME < thread-id.json
sideleaf suggestion-reject FILE --if-thread-revision REV --actor NAME < thread-id.json
sideleaf open FILE [--app PATH]
sideleaf open-folder DIRECTORY [--app PATH]
sideleaf skills install [--user | --target NAME] [--force]

edit.json: {"from":0,"to":0,"text":"New text\\n"}
comment.json: {"from":0,"to":8,"body":"A thought"}
update.json: {"id":"comment-id","body":"Revised thought"}
remove.json: {"id":"comment-id"}
thread.json: {"from":0,"to":8,"body":"A thought"}
reply.json: {"threadId":"thread-id","body":"A reply"}
message.json: {"threadId":"thread-id","messageId":"message-id","body":"Revised reply"}
thread-id.json: {"threadId":"thread-id"}
suggestion.json: {"target":{"quote":"old text","prefix":"context"},"replacement":"new text","body":"Why this change"}
focus.json: {"contract":"sideleaf-focus/v1","kind":"range","from":0,"to":200}
apply.json: {"contract":"sideleaf-apply/v1","ifRevision":"REV","operations":[{"kind":"replace","from":0,"to":0,"text":"New text\\n"}]}

Offsets are zero-based UTF-16 code units in logical LF source, end-exclusive.
Apply accepts 1–64 sequential operations atomically. replace-quote,
thread-add-quote and suggestion-add accept target {quote,prefix?,suffix?}; the match must be unique.
Use read.revision as --if-revision (or apply.json ifRevision) for offset
replacements and new threads. Unique quote/context operations do not require it.
Existing-thread batch operations carry ifThreadRevision from
threads[].revision; dedicated commands use --if-thread-revision. Use wait's
--actor to exclude that actor; --actor, --thread and --mention filters combine.
Actor names are explicit attribution, not authenticated identities. Exit: 0 success, 2 input/usage,
3 revision conflict or writer lock, 4 busy/uncertain live request,
1 filesystem/runtime failure.
Use --input PATH instead of stdin. The desktop app supplies the runtime.
Skill targets: agents, claude, codex, omp, hermes, pi. The default installs
~/.agents/skills/sideleaf/SKILL.md. --user installs all supported user targets.
In WSL, skills install into the WSL home. --force explicitly replaces a locally
modified Sideleaf skill; without it, the existing file is left unchanged.
With no arguments, Sideleaf starts or activates. FILE is shorthand for open FILE.
`;
// ASCII JSON survives legacy PowerShell code pages without corrupting Unicode.
function json(value: unknown) { return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`); }
function output(value: unknown) { process.stdout.write(`${json(value)}\n`); }
function inputError(message: string): never { throw Object.assign(new Error(message), { exitCode: 2 }); }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) inputError("Offsets must be nonnegative UTF-16 integers."); return value as number; }
function body(value: unknown): string { if (typeof value !== "string" || !value.trim() || value.length > 20_000) inputError("Comment body must contain 1–20,000 characters."); return value; }
async function threadViews(threads: ReviewThread[]) {
  return Promise.all(threads.map(async (thread) => ({ ...thread, revision: await threadRevision(thread) })));
}
function revisionViews(revisions: Array<{ threads: ReviewThread[] } & Record<string, unknown>>) {
  return revisions.map((revision) => ({ ...revision, comments: legacyComments(revision.threads) }));
}

function appChannelRoot(override?: string): string {
  if (!override) return sideleafUserData("stable");
  const app = resolve(override);
  let versionPath: string;
  if (process.platform === "darwin") versionPath = join(app, "Contents", "Resources", "version.json");
  else versionPath = join(dirname(app), "..", "Resources", "version.json");
  let version: { identifier?: unknown; channel?: unknown };
  try { version = JSON.parse(readFileSync(versionPath, "utf8")); }
  catch { inputError("The selected Sideleaf app does not contain readable version metadata."); }
  if (version.identifier !== "ai.kortexa.sideleaf" || typeof version.channel !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(version.channel)) {
    inputError("The selected app is not a compatible Sideleaf build.");
  }
  if (process.platform === "win32") {
    const identifierRoot = resolve(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ai.kortexa.sideleaf");
    const installedRoot = resolve(dirname(app), "..", "..");
    if (dirname(installedRoot).toLowerCase() === identifierRoot.toLowerCase()) return sideleafUserData(basename(installedRoot));
  }
  return sideleafUserData(version.channel);
}

async function openDesktop(command: AppCommand, override?: string): Promise<"running" | "launched"> {
  const wsl = process.platform === "linux" && !!process.env.WSL_DISTRO_NAME;
  if (!wsl) {
    const delivered = await deliverAppCommand(appChannelRoot(override), command);
    if (delivered.delivered) return "running";
  }
  if (process.platform === "darwin") {
    const target = override ? ["-a", resolve(override)] : ["-b", "ai.kortexa.sideleaf"];
    if (command.kind === "open") target.push(command.path);
    else if (command.kind === "open-folder") target.push("--env", `SIDELEAF_OPEN_PATH=${command.path}`, "--env", "SIDELEAF_OPEN_KIND=folder");
    execFileSync("/usr/bin/open", target);
    return "launched";
  }
  let app = override;
  if (!app && wsl) inputError("Use --app with the installed Windows bin/launcher.exe path (in /mnt/c/...) for desktop opening from WSL.");
  app ??= join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ai.kortexa.sideleaf", "stable", "app", "bin", "launcher.exe");
  if (!existsSync(app)) inputError("Sideleaf launcher was not found. Use --app PATH.");
  const marker = command.kind === "open-folder" ? "--sideleaf-open-folder" : "--sideleaf-open";
  const launchArguments = command.kind === "activate" ? [] : [marker, command.path];
  if (wsl) {
    const nativeApp = execFileSync("wslpath", ["-w", resolve(app)], { encoding: "utf8" }).trim();
    const nativeFolder = execFileSync("wslpath", ["-w", dirname(resolve(app))], { encoding: "utf8" }).trim();
    const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const environment = command.kind === "activate" ? "" : `$env:SIDELEAF_OPEN_PATH = ${literal(command.path)}; $env:SIDELEAF_OPEN_KIND = ${literal(command.kind === "open-folder" ? "folder" : "file")}; `;
    const argumentsLiteral = launchArguments.map(literal).join(", ");
    const script = `$ErrorActionPreference = 'Stop'; ${environment}Start-Process -FilePath ${literal(nativeApp)} -WorkingDirectory ${literal(nativeFolder)}${argumentsLiteral ? ` -ArgumentList @(${argumentsLiteral})` : ""}`;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdio: "ignore" });
  } else {
    const environment = command.kind === "activate" ? process.env : { ...process.env, SIDELEAF_OPEN_PATH: command.path, SIDELEAF_OPEN_KIND: command.kind === "open-folder" ? "folder" : "file" };
    const child = spawn(resolve(app), launchArguments, { detached: true, stdio: "ignore", cwd: dirname(resolve(app)), env: environment });
    await new Promise<void>((accept, reject) => { child.once("spawn", accept); child.once("error", reject); }); child.unref();
  }
  return "launched";
}

async function readInput(options: Map<string, string>): Promise<Record<string, unknown>> {
  let raw: Buffer;
  const input = options.get("--input");
  if (input) {
    if (statSync(input).size > 2 * MAX_DOCUMENT_BYTES) inputError("Input exceeds 20 MiB.");
    raw = readFileSync(input);
  } else {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 2 * MAX_DOCUMENT_BYTES) inputError("Input exceeds 20 MiB."); chunks.push(Buffer.from(chunk)); }
    raw = Buffer.concat(chunks);
  }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { inputError("Input must be valid UTF-8 JSON."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) inputError("Input must be a JSON object.");
  return payload as Record<string, unknown>;
}

function collaborationTarget(filename: string | undefined, documentId: string | undefined): { target: DocumentTarget; path: string | null } {
  if (documentId) {
    if (!/^[a-f0-9-]{36}$/.test(documentId)) inputError("--document requires a Sideleaf document ID.");
    return { target: { documentId }, path: null };
  }
  if (!filename || filename.startsWith("--")) inputError("A document path is required.");
  let path = resolve(filename);
  if (process.platform === "linux" && /^[a-z]:[\\/]/i.test(filename)) path = execFileSync("wslpath", ["-u", filename], { encoding: "utf8" }).trim();
  if (existsSync(path)) {
    if (!statSync(path).isFile()) inputError("A file path is required.");
    path = realpathSync(path);
  } else {
    try { path = join(realpathSync(dirname(path)), basename(path)); } catch { /* The live query below remains fail-closed. */ }
  }
  return { target: { path }, path };
}

function assertOfflineFile(path: string) {
  if (!existsSync(path) || !statSync(path).isFile()) inputError("A file path is required.");
}

async function appCollaboration<T>(operation: CollaborationOperation, override?: string, timeoutMs?: number) {
  return requestApp<T>(appChannelRoot(override), { kind: "collaboration", operation }, { ...(timeoutMs ? { timeoutMs } : {}) });
}

async function withOfflineLock<T>(path: string, operation: (lock: DocumentLock) => Promise<T> | T): Promise<T> {
  const lock = await acquireDocumentLockAsync(path);
  try { return await operation(lock); } finally { lock.release(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { output({ ok: true, delivery: await openDesktop({ kind: "activate" }) }); return; }
  if (args[0] === "--help" || args[0] === "help") { process.stdout.write(help); return; }
  if (args[0] === "--app") {
    if (args.length !== 2 || !args[1]) inputError("Use sideleaf --app PATH to activate a specific Sideleaf build.");
    output({ ok: true, delivery: await openDesktop({ kind: "activate" }, args[1]) }); return;
  }
  let command = args.shift()!;
  if (command === "skills") {
    if (args[0] === "--help" || args[0] === "help") { process.stdout.write(help); return; }
    const options = parseSkillInstallArgs(args);
    const targets = installSideleafSkills({ home: options.home ?? process.env.SIDELEAF_SKILLS_HOME, ...options });
    output({ ok: true, skill: "sideleaf", targets }); return;
  }
  if (!["read", "comments", "threads", "documents", "focus", "apply", "wait", "edit", "comment-add", "comment-update", "comment-remove",
    "thread-add", "thread-reply", "thread-message-update", "thread-message-delete", "thread-resolve", "thread-reopen", "thread-delete",
    "suggestion-add", "suggestion-accept", "suggestion-reject", "open", "open-folder"].includes(command)) {
    if (command.startsWith("-")) inputError("Unknown command. Run sideleaf --help.");
    args.unshift(command); command = "open";
  }
  let documentId: string | undefined;
  if (args[0] === "--document") { args.shift(); documentId = args.shift(); if (!documentId) inputError("--document requires an ID."); }
  const filename = command === "documents" || documentId ? undefined : args.shift();
  if (command !== "documents" && !documentId && (!filename || filename.startsWith("--"))) inputError("A document path is required.");
  const options = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!;
    if (key === "--json") continue;
    if (!["--if-revision", "--if-thread-revision", "--actor", "--input", "--app", "--after", "--timeout", "--thread", "--mention"].includes(key) || options.has(key) || !args.length) inputError(`Invalid option: ${key}`);
    options.set(key, args.shift()!);
  }
  const override = options.get("--app");
  if (command === "documents") {
    if ([...options.keys()].some((key) => key !== "--app")) inputError("documents accepts only --app PATH.");
    const result = await appCollaboration<Record<string, unknown>>({ kind: "documents" }, override);
    if (!result.delivered) throw new CollaborationError("Sideleaf is not running; document IDs exist only for live buffers.", "NOT_FOUND");
    output({ ...(result.value ?? {}), requestId: result.requestId }); return;
  }
  let path = filename ? resolve(filename) : "";
  if (filename && process.platform === "linux" && /^[a-z]:[\\/]/i.test(filename)) path = execFileSync("wslpath", ["-u", filename], { encoding: "utf8" }).trim();
  if (command === "open" || command === "open-folder") {
    if (documentId) inputError("Desktop open requires a path.");
    if (!existsSync(path)) inputError("The path does not exist.");
    if (command === "open-folder" ? !statSync(path).isDirectory() : !statSync(path).isFile()) inputError(command === "open-folder" ? "A folder path is required." : "A file path is required. Use open-folder for a directory.");
    if (process.platform === "linux" && !!process.env.WSL_DISTRO_NAME) path = execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
    const action: AppCommand = command === "open-folder" ? { kind: "open-folder", path } : { kind: "open", path };
    output({ ok: true, path, delivery: await openDesktop(action, override) }); return;
  }
  const resolved = collaborationTarget(filename, documentId);
  const target = resolved.target; path = resolved.path ?? "";

  const liveRead = async (): Promise<Record<string, any> | null> => {
    const result = await appCollaboration<Record<string, unknown>>({ kind: "read", target }, override);
    if (!result.delivered || result.value?.owned === false) return null;
    if (result.value?.owned !== true) throw new CollaborationError("Sideleaf returned an invalid live read result.", "UNCERTAIN", true);
    const { owned: _owned, ...value } = result.value;
    return { ...value, requestId: result.requestId };
  };
  if (command === "read" || command === "comments" || command === "threads") {
    let value: Record<string, any> | null = await liveRead();
    if (!value) {
      if (!path) throw new CollaborationError("The Sideleaf document ID is no longer open.", "NOT_FOUND");
      assertOfflineFile(path);
      value = await liveRead();
      if (!value) {
        const file = DocumentFile.open(path), draft = file.snapshot();
        const cursor = fileCursor(file.revision());
        value = command === "read"
          ? { path: file.path, revision: file.revision(), cursor, text: draft.text, comments: legacyComments(draft.threads), threads: await threadViews(draft.threads), revisions: revisionViews(file.history()), lineEnding: draft.lineEnding, notice: draft.notice }
          : command === "comments" ? { revision: file.revision(), cursor, comments: legacyComments(draft.threads) }
            : { revision: file.revision(), cursor, threads: await threadViews(draft.threads) };
      }
    }
    output(command === "comments" && value.live === true ? { contract: value.contract, live: true, saved: value.saved, dirty: value.dirty,
      documentId: value.documentId, revision: value.revision, savedRevision: value.savedRevision, comments: value.comments, requestId: value.requestId } :
      command === "threads" ? { contract: value.contract, live: value.live ?? false, saved: value.saved ?? true, dirty: value.dirty ?? false,
        documentId: value.documentId ?? null, revision: value.revision, savedRevision: value.savedRevision ?? value.revision,
        cursor: value.cursor, threads: await threadViews(value.threads), requestId: value.requestId } : value);
    return;
  }

  if (command === "focus") {
    if ([...options.keys()].some((key) => !["--input", "--app"].includes(key))) inputError("focus accepts only --input PATH and --app PATH.");
    const request = await readInput(options);
    const live = await appCollaboration<Record<string, any>>({ kind: "focus", target, request }, override);
    if (live.delivered && live.value?.owned === true) { const { owned: _owned, ...value } = live.value; output({ ...value, requestId: live.requestId }); return; }
    if (live.delivered && live.value?.owned !== false) throw new CollaborationError("Sideleaf returned an invalid focused read.", "UNCERTAIN", true);
    if (!path) throw new CollaborationError("The Sideleaf document ID is no longer open.", "NOT_FOUND");
    assertOfflineFile(path);
    const file = DocumentFile.open(path), draft = file.snapshot(), focused = focusDraft(draft, request);
    const value = focused.kind === "thread" ? { kind: focused.kind, thread: { ...focused.thread, revision: await threadRevision(focused.thread) } } : focused;
    output({ contract: COLLABORATION_CONTRACT, live: false, saved: true, dirty: false, documentId: null, path: file.path,
      revision: file.revision(), savedRevision: file.revision(), cursor: fileCursor(file.revision()), ...value }); return;
  }

  if (command === "wait") {
    const after = options.get("--after");
    if (!after) inputError("wait requires --after CURSOR from read, focus or apply.");
    const seconds = Number(options.get("--timeout") ?? "30");
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) inputError("--timeout must be 1–120 seconds.");
    if ([...options.keys()].some((key) => !["--after", "--timeout", "--app", "--actor", "--thread", "--mention"].includes(key))) inputError("Invalid wait option.");
    const actor = options.get("--actor"), threadId = options.get("--thread"), mention = options.get("--mention");
    if (actor !== undefined && (!actor.trim() || actor.length > 200)) inputError("--actor must contain 1–200 characters.");
    if (threadId !== undefined && (!threadId || threadId.length > 100)) inputError("--thread requires a valid thread ID.");
    if (mention !== undefined && (!mention || mention.length > 200)) inputError("--mention must contain 1–200 characters.");
    const timeoutMs = seconds * 1_000;
    const operation = { kind: "wait" as const, target, after, timeoutMs, ...(actor ? { actor } : {}), ...(threadId ? { threadId } : {}), ...(mention ? { mention } : {}) };
    const result = await appCollaboration<Record<string, unknown>>(operation, override, timeoutMs + 2_000);
    if (result.delivered && result.value?.owned === true) { output({ ...(result.value ?? {}), requestId: result.requestId }); return; }
    if (result.delivered && result.value?.owned !== false) throw new CollaborationError("Sideleaf returned an invalid wait result.", "UNCERTAIN", true);
    if (!path) throw new CollaborationError("The Sideleaf document ID is no longer open.", "NOT_FOUND");
    assertOfflineFile(path);
    let file = DocumentFile.open(path), baseline = file.snapshot(), cursor = fileCursor(file.revision());
    if (after !== cursor) { output({ contract: COLLABORATION_CONTRACT, live: false, outcome: "resync", cursor, reason: "gap" }); return; }
    const deadline = Date.now() + timeoutMs; let nextOwnershipCheck = 0;
    while (Date.now() < deadline) {
      await new Promise((accept) => setTimeout(accept, Math.min(100, deadline - Date.now())));
      if (Date.now() >= nextOwnershipCheck) {
        nextOwnershipCheck = Date.now() + 500;
        const owner = await appCollaboration<Record<string, unknown>>({ kind: "ownership", target }, override);
        if (owner.delivered && owner.value?.owned === true) {
          const live = await appCollaboration<Record<string, unknown>>(operation, override, Math.max(1_000, deadline - Date.now() + 1_000));
          if (!live.delivered || live.value?.owned !== true) throw new CollaborationError("Document ownership changed during wait. Run a focused resync.", "UNCERTAIN", true);
          output({ ...(live.value ?? {}), requestId: live.requestId }); return;
        }
        if (owner.delivered && owner.value?.owned !== false) throw new CollaborationError("Sideleaf returned an invalid ownership result.", "UNCERTAIN", true);
      }
      if (!file.pollChanged()) continue;
      const next = DocumentFile.open(path), nextCursor = fileCursor(next.revision());
      if (nextCursor === cursor) { file = next; continue; }
      const snapshot = next.snapshot(), fallbackActor = next.history()[0]?.actor ?? "Local user";
      const matching = diffDraftActivity(baseline, snapshot, fallbackActor).filter((candidate) => matchesActivity(candidate, { actor, threadId, mention }));
      file = next; baseline = snapshot; cursor = nextCursor;
      if (matching.length > 1) { output({ contract: COLLABORATION_CONTRACT, live: false, outcome: "resync", cursor, reason: "gap" }); return; }
      if (matching[0]) {
        const visible = publicActivity({ ...matching[0], documentId: file.id, cursor });
        output({ contract: COLLABORATION_CONTRACT, live: false, outcome: "event", cursor, event: visible }); return;
      }
    }
    output({ contract: COLLABORATION_CONTRACT, live: false, outcome: "timeout", cursor }); return;
  }

  const actor = options.get("--actor");
  if (!actor?.trim() || actor.length > 200) inputError("Writes require --actor NAME (1–200 characters).");
  const revision = options.get("--if-revision");
  if (revision && !/^[a-f0-9]{64}$/.test(revision) && !/^sl1\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[0-9]+$/.test(revision)) inputError("Invalid --if-revision; use the value from sideleaf read.");
  const threadGuard = options.get("--if-thread-revision");
  if (threadGuard && !/^st1\.[a-f0-9]{64}$/.test(threadGuard)) inputError("Invalid --if-thread-revision; use the value from sideleaf threads.");
  const payload = await readInput(options);

  const modern = command === "apply" || command.startsWith("thread-") || command.startsWith("suggestion-");
  if (modern) {
    let envelopeValue: unknown = payload;
    if (command !== "apply") envelopeValue = { operations: [{ ...payload, kind: command }] };
    const envelope = parseApplyEnvelope(envelopeValue);
    const needsGlobal = requiresDocumentRevision(envelope);
    if (needsGlobal && !revision && !envelope.ifRevision) inputError(`${command} requires a document revision in --if-revision or the apply envelope.`);
    const needsThread = command !== "apply" && (command.startsWith("thread-") && command !== "thread-add" || command === "suggestion-accept" || command === "suggestion-reject");
    if (needsThread && !threadGuard) inputError(`${command} requires --if-thread-revision from sideleaf threads.`);
    const route = async () => appCollaboration<Record<string, unknown>>({ kind: "apply", target, actor, ...(revision ? { ifRevision: revision } : {}),
      ...(threadGuard ? { ifThreadRevision: threadGuard } : {}), envelope, deadline: Date.now() + 3_500 }, override);
    let result = await route();
    if (result.delivered && result.value?.owned === true) { output({ ...result.value, requestId: result.requestId }); return; }
    if (result.delivered && result.value?.owned !== false) throw new CollaborationError("Sideleaf returned an invalid apply result.", "UNCERTAIN", true);
    if (!path) throw new CollaborationError("The Sideleaf document ID is no longer open.", "NOT_FOUND");
    assertOfflineFile(path);
    const receipt = await withOfflineLock(path, async (lock) => {
      result = await route();
      if (result.delivered && result.value?.owned === true) return { ...result.value, requestId: result.requestId };
      if (result.delivered && result.value?.owned !== false) throw new CollaborationError("Sideleaf returned an invalid apply result.", "UNCERTAIN", true);
      const file = DocumentFile.open(path, lock), current = file.snapshot();
      const evaluated = await evaluateApply(current, envelope, { actor, currentRevision: file.revision(), ifRevision: revision, ifThreadRevision: threadGuard });
      file.save(evaluated.draft, undefined, actor, lock);
      return { ok: true, contract: COLLABORATION_CONTRACT, live: false, saved: true, dirty: false, documentId: null, path: file.path,
        revision: file.revision(), savedRevision: file.revision(), cursor: fileCursor(file.revision()), operations: envelope.operations.length,
        change: evaluated.change, changes: evaluated.summary.changes, created: evaluated.summary.created, changed: evaluated.summary.changed };
    });
    output(receipt); return;
  }

  if (!revision) inputError(`${command} requires --if-revision from sideleaf read.`);
  if (threadGuard) inputError(`${command} does not accept --if-thread-revision.`);
  if (documentId) inputError(`${command} requires a file path; use apply for an open document ID.`);
  assertOfflineFile(path);
  const assertLegacyUnowned = async () => {
    const result = await appCollaboration<{ owned?: unknown }>({ kind: "ownership", target }, override);
    if (result.delivered && result.value?.owned === true) throw Object.assign(new Error("This document is open in Sideleaf; use apply so the live buffer remains authoritative."), { exitCode: 3 });
    if (result.delivered && result.value?.owned !== false) throw new CollaborationError("Sideleaf returned an invalid ownership result.", "UNCERTAIN", true);
  };
  await assertLegacyUnowned();
  const result = await withOfflineLock(path, async (lock) => {
    await assertLegacyUnowned();
    const file = DocumentFile.open(path, lock), draft = file.snapshot();
    if (revision !== file.revision()) throw Object.assign(new Error("Revision conflict: reread the document before writing."), { exitCode: 3 });
  const now = new Date().toISOString();
  if (command === "edit") {
    const from = integer(payload.from), to = integer(payload.to);
    if (to < from || to > draft.text.length || typeof payload.text !== "string" || payload.text.includes("\r")) inputError("Invalid edit range/text; use logical LF line endings.");
    for (const offset of [from, to]) if (offset > 0 && /[\uD800-\uDBFF]/.test(draft.text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(draft.text[offset]!)) inputError("An edit cannot split a Unicode surrogate pair.");
    const text = draft.text.slice(0, from) + payload.text + draft.text.slice(to);
    const delta = payload.text.length - (to - from);
    draft.threads = draft.threads.map((thread) => {
      const a = thread.anchor;
      if (a.state === "orphaned") return thread;
      if ((from < a.to && to > a.from) || (from === to && from > a.from && from < a.to)) return { ...thread, anchor: { ...a, state: "orphaned" as const } };
      const start = a.from + (to <= a.from ? delta : 0), end = a.to + (to < a.to || (to === a.to && from < to) ? delta : 0);
      return { ...thread, anchor: makeAnchor(text, start, end) };
    });
    draft.text = text;
  } else if (command === "comment-add") {
    const id = randomUUID();
    draft.threads.push({ id, state: "open", anchor: makeAnchor(draft.text, integer(payload.from), integer(payload.to)), messages: [{ id, body: body(payload.body), createdAt: now, author: actor }] });
  } else {
    const thread = draft.threads.find((candidate) => candidate.id === payload.id);
    if (!thread) inputError("Comment ID was not found.");
    if (command === "comment-remove") {
      if (thread.messages.length > 1) inputError("This comment has replies. Use thread-delete with its semantic revision for an explicit destructive deletion.");
      draft.threads = draft.threads.filter((candidate) => candidate !== thread);
    } else {
      const root = thread.messages[0]!; root.body = body(payload.body); root.updatedAt = now; root.updatedBy = actor;
    }
  }
    file.save(draft, undefined, actor, lock);
    return { ok: true, revision: file.revision(), text: draft.text, comments: legacyComments(draft.threads) };
  });
  output(result);
}
main().catch((error) => {
  const code = error.exitCode ?? (error instanceof CollaborationError ? (error.code === "INVALID" ? 2 : error.code === "CONFLICT" ? 3 : 4) :
    error instanceof AppChannelError ? (error.code === "CONFLICT" ? 3 : 4) : /changed on disk|changed during|holds this document|Revision conflict/.test(error.message) ? 3 : 1);
  process.stderr.write(`${json({ ok: false, error: error.message, code, ...(error.code ? { reason: error.code } : {}),
    ...(error.retryable ? { retryable: true } : {}), ...(error.requestId ? { requestId: error.requestId } : {}) })}\n`); process.exitCode = code;
});
