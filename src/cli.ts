#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DocumentFile } from "./document/files.ts";
import { makeAnchor } from "./document/anchors.ts";
import { MAX_DOCUMENT_BYTES } from "./shared/contracts.ts";

const help = `sideleaf — local Markdown and comments (JSON output)

sideleaf read FILE
sideleaf comments FILE
sideleaf edit FILE --if-revision HASH --actor NAME < edit.json
sideleaf comment-add FILE --if-revision HASH --actor NAME < comment.json
sideleaf comment-update FILE --if-revision HASH --actor NAME < update.json
sideleaf comment-remove FILE --if-revision HASH --actor NAME < remove.json
sideleaf open FILE [--app PATH]

edit.json: {"from":0,"to":0,"text":"New text\\n"}
comment.json: {"from":0,"to":8,"body":"A thought"}
update.json: {"id":"comment-id","body":"Revised thought"}
remove.json: {"id":"comment-id"}

Offsets are zero-based UTF-16 code units in logical LF source, end-exclusive.
Use read.revision as --if-revision for every write. Actor names are explicit
attribution, not authenticated identities. Exit: 0 success, 2 input/usage,
3 revision conflict or writer lock, 1 filesystem/runtime failure.
Use --input PATH instead of stdin. Node.js 24+ is required.
`;
// ASCII JSON survives legacy PowerShell code pages without corrupting Unicode.
function json(value: unknown) { return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`); }
function output(value: unknown) { process.stdout.write(`${json(value)}\n`); }
function inputError(message: string): never { throw Object.assign(new Error(message), { exitCode: 2 }); }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) inputError("Offsets must be nonnegative UTF-16 integers."); return value as number; }
function body(value: unknown): string { if (typeof value !== "string" || !value.trim() || value.length > 20_000) inputError("Comment body must contain 1–20,000 characters."); return value; }

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "help") { process.stdout.write(help); return; }
  const command = args.shift()!;
  if (!["read", "comments", "edit", "comment-add", "comment-update", "comment-remove", "open"].includes(command)) inputError("Unknown command. Run sideleaf --help.");
  const filename = args.shift();
  if (!filename || filename.startsWith("--")) inputError("A document path is required.");
  const options = new Map<string, string>();
  while (args.length) {
    const key = args.shift()!;
    if (key === "--json") continue;
    if (!["--if-revision", "--actor", "--input", "--app"].includes(key) || options.has(key) || !args.length) inputError(`Invalid option: ${key}`);
    options.set(key, args.shift()!);
  }
  let path = resolve(filename);
  if (process.platform === "linux" && /^[a-z]:[\\/]/i.test(filename)) path = execFileSync("wslpath", ["-u", filename], { encoding: "utf8" }).trim();
  if (command === "open") {
    if (!existsSync(path)) inputError("The document does not exist.");
    const override = options.get("--app");
    if (process.platform === "darwin") {
      execFileSync("/usr/bin/open", ["-n", ...(override ? ["-a", resolve(override)] : ["-b", "ai.kortexa.sideleaf"]), "--env", `SIDELEAF_OPEN_PATH=${path}`]);
    } else {
      const wsl = process.platform === "linux" && !!process.env.WSL_DISTRO_NAME;
      if (wsl) path = execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
      let app = override;
      if (!app && wsl) inputError("Use --app with the installed Windows bin/launcher.exe path (in /mnt/c/...) for desktop opening from WSL.");
      app ??= join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ai.kortexa.sideleaf", "stable", "app", "bin", "launcher.exe");
      if (!existsSync(app)) inputError("Sideleaf launcher was not found. Use --app PATH.");
      if (wsl) {
        const nativeApp = execFileSync("wslpath", ["-w", resolve(app)], { encoding: "utf8" }).trim();
        const nativeFolder = execFileSync("wslpath", ["-w", dirname(resolve(app))], { encoding: "utf8" }).trim();
        const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
        // Start in a native Windows process so the app outlives WSL interop's
        // short-lived command and receives the requested file in its environment.
        const script = `$ErrorActionPreference = 'Stop'; $env:SIDELEAF_OPEN_PATH = ${literal(path)}; Start-Process -FilePath ${literal(nativeApp)} -WorkingDirectory ${literal(nativeFolder)}`;
        execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { stdio: "ignore" });
      } else {
        const child = spawn(resolve(app), ["--sideleaf-open", path], { detached: true, stdio: "ignore", cwd: dirname(resolve(app)), env: { ...process.env, SIDELEAF_OPEN_PATH: path } });
        await new Promise<void>((accept, reject) => { child.once("spawn", accept); child.once("error", reject); }); child.unref();
      }
    }
    output({ ok: true, path }); return;
  }
  const file = DocumentFile.open(path);
  const draft = file.snapshot();
  if (command === "read") { output({ path: file.path, revision: file.revision(), text: draft.text, comments: draft.comments, revisions: file.history(), lineEnding: draft.lineEnding, notice: draft.notice }); return; }
  if (command === "comments") { output({ revision: file.revision(), comments: draft.comments }); return; }
  const actor = options.get("--actor");
  if (!actor?.trim() || actor.length > 200) inputError("Writes require --actor NAME (1–200 characters).");
  const revision = options.get("--if-revision");
  if (!revision || !/^[a-f0-9]{64}$/.test(revision)) inputError("Writes require --if-revision from sideleaf read.");
  if (revision !== file.revision()) throw Object.assign(new Error("Revision conflict: reread the document before writing."), { exitCode: 3 });
  // Bound input before parsing, including pipe input (readFileSync(0) is unbounded).
  let raw: Buffer;
  const input = options.get("--input");
  if (input) { const { statSync } = await import("node:fs"); if (statSync(input).size > 2 * MAX_DOCUMENT_BYTES) inputError("Input exceeds 20 MiB."); raw = readFileSync(input); }
  else {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 2 * MAX_DOCUMENT_BYTES) inputError("Input exceeds 20 MiB."); chunks.push(Buffer.from(chunk)); }
    raw = Buffer.concat(chunks);
  }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { inputError("Input must be valid UTF-8 JSON."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) inputError("Input must be a JSON object.");
  const now = new Date().toISOString();
  if (command === "edit") {
    const from = integer(payload.from), to = integer(payload.to);
    if (to < from || to > draft.text.length || typeof payload.text !== "string" || payload.text.includes("\r")) inputError("Invalid edit range/text; use logical LF line endings.");
    for (const offset of [from, to]) if (offset > 0 && /[\uD800-\uDBFF]/.test(draft.text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(draft.text[offset]!)) inputError("An edit cannot split a Unicode surrogate pair.");
    const text = draft.text.slice(0, from) + payload.text + draft.text.slice(to);
    const delta = payload.text.length - (to - from);
    draft.comments = draft.comments.map((comment) => {
      const a = comment.anchor;
      if (a.state === "orphaned") return comment;
      if ((from < a.to && to > a.from) || (from === to && from > a.from && from < a.to)) return { ...comment, anchor: { ...a, state: "orphaned" as const } };
      const start = a.from + (to <= a.from ? delta : 0), end = a.to + (to < a.to || (to === a.to && from < to) ? delta : 0);
      return { ...comment, anchor: makeAnchor(text, start, end) };
    });
    draft.text = text;
  } else if (command === "comment-add") {
    draft.comments.push({ id: randomUUID(), body: body(payload.body), createdAt: now, author: actor, anchor: makeAnchor(draft.text, integer(payload.from), integer(payload.to)) });
  } else {
    const comment = draft.comments.find((c) => c.id === payload.id);
    if (!comment) inputError("Comment ID was not found.");
    if (command === "comment-remove") draft.comments = draft.comments.filter((c) => c !== comment);
    else { comment.body = body(payload.body); comment.updatedAt = now; comment.updatedBy = actor; }
  }
  file.save(draft, undefined, actor);
  output({ ok: true, revision: file.revision(), text: draft.text, comments: draft.comments });
}
main().catch((error) => {
  const code = error.exitCode ?? (/changed on disk|changed during|holds this document|Revision conflict/.test(error.message) ? 3 : 1);
  process.stderr.write(`${json({ ok: false, error: error.message, code })}\n`); process.exitCode = code;
});
