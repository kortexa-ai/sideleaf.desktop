import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { atomicWrite } from "./document/files.ts";

export const SKILL_TARGETS = {
  agents: [".agents", "skills"],
  claude: [".claude", "skills"],
  codex: [".codex", "skills"],
  omp: [".omp", "skills"],
  hermes: [".hermes", "skills"],
  pi: [".pi", "agent", "skills"],
} as const;

export type SkillTarget = keyof typeof SKILL_TARGETS;
export type SkillInstallResult = { target: SkillTarget; path: string; status: "installed" | "updated" | "unchanged" };

export const SIDELEAF_SKILL = `---
name: sideleaf
description: Use Sideleaf's local CLI to read, author, edit, and review Markdown files with portable embedded review threads.
---

# Work with Markdown in Sideleaf

Use Sideleaf for local Markdown work when review threads or revision-safe edits need to remain in the same portable file. It does not require a running Sideleaf window or network access.

Sideleaf stores review metadata in a terminal HTML comment. Do not edit that block by hand. Use the CLI so the visible Markdown, comment anchors, and retained revision data stay consistent.

## Read before writing

Run \`sideleaf read FILE\` to get the visible text, threads, compatibility comments, current document revision, and semantic activity cursor as JSON. Run \`sideleaf threads FILE\` for the current threads and their semantic revisions. Use \`sideleaf focus FILE\` for a bounded range, exact passage, or one thread when the full source is unnecessary.

Recovered named drafts reopen as separate untitled copies with new document IDs. Run \`sideleaf documents\` after recovery, identify the recovered copy by name and exact ID, then use \`--document ID\`; rereading the original path addresses the saved original rather than the unsaved recovered copy.

Before an offset replacement or offset-anchored root thread, read the file again and pass that exact revision with \`--if-revision HASH\`. An exact unique quote/context operation can tolerate unrelated source edits. Before replying, editing or deleting a reply, resolving, reopening, or deleting a thread, run \`sideleaf threads FILE\` and pass that thread's exact \`revision\` with \`--if-thread-revision HASH\`. Add \`--if-revision\` too when the whole document must remain unchanged. Pass a clear identity such as \`--actor agent:reviewer\`. If a write exits with code 3, reread and reconsider the operation; do not blindly retry.

## Author and edit

Create a new file as ordinary UTF-8 Markdown with the available file-writing tool. Then use \`sideleaf read FILE\` before adding comments or making later revision-checked edits.

For an existing file, send a zero-based, end-exclusive UTF-16 range and replacement text as JSON:

\`\`\`sh
sideleaf edit FILE --if-revision HASH --actor agent:reviewer <<'JSON'
{"from":0,"to":0,"text":"# Notes\\n\\n"}
JSON
\`\`\`

Use offsets from the logical LF text returned by \`sideleaf read\`. Never count bytes, and never split a Unicode surrogate pair.

## Review threads

Add a comment to an exact source range:

\`\`\`sh
sideleaf thread-add FILE --if-revision HASH --actor agent:reviewer <<'JSON'
{"from":2,"to":7,"body":"Please check this wording."}
JSON
\`\`\`

Read the returned thread list, or run \`sideleaf threads FILE\`, before acting on that thread:

\`\`\`sh
sideleaf thread-reply FILE --if-thread-revision THREAD_HASH --actor agent:reviewer <<'JSON'
{"threadId":"THREAD_ID","body":"Reply text"}
JSON

sideleaf thread-resolve FILE --if-thread-revision NEW_THREAD_HASH --actor agent:reviewer <<'JSON'
{"threadId":"THREAD_ID"}
JSON
\`\`\`

The other explicit thread commands are \`thread-message-update\`, \`thread-message-delete\`, \`thread-reopen\`, and \`thread-delete\`. Deleting a thread removes its full discussion and should be deliberate. Legacy \`comments\`, \`comment-add\`, and \`comment-update\` address root messages; \`comment-remove\` refuses a thread that already has replies so it cannot erase discussion accidentally.

Create a review suggestion when you want a human decision before changing source:

\`\`\`sh
sideleaf suggestion-add FILE --actor agent:reviewer <<'JSON'
{"target":{"quote":"old wording","prefix":"Exact context "},"replacement":"clear wording","body":"This is more direct."}
JSON
\`\`\`

The command leaves source unchanged. Focus the returned thread ID, then start one quiet, scoped wait for the human decision and inspect its event. Use \`suggestion-accept\` or \`suggestion-reject\` with the exact \`--if-thread-revision\` only when the user has explicitly delegated that decision. Accept rechecks the stored exact quote/context and applies replacement plus terminal state atomically; an empty replacement intentionally deletes the passage. Reject changes only the suggestion state. Missing, changed, orphaned, ambiguous, stale or already-decided suggestions refuse without a partial write. Keep using direct replacements for changes that are already authorized.

## Batch and wait

Use \`sideleaf apply FILE --actor agent:reviewer\` with a \`sideleaf-apply/v1\` JSON envelope to commit 1–64 sequential operations atomically. Put the starting document revision in \`ifRevision\` whenever the batch uses offset-addressed \`replace\` or \`thread-add\`; it may also guard any complete batch. Put \`ifThreadRevision\` on each operation that changes an existing thread. Quote-addressed \`replace-quote\`, \`thread-add-quote\` and \`suggestion-add\` operations accept an exact \`quote\` plus optional exact \`prefix\` and \`suffix\`, can survive unrelated source edits, and refuse a missing or ambiguous match. Suggestion decisions are existing-thread operations and require \`ifThreadRevision\`.

Every read, focus and apply returns a cursor. \`sideleaf wait FILE --after CURSOR\` remains silent until one semantic event, timeout, app close, or resync. Add \`--actor NAME\` to exclude your own activity, and combine \`--thread ID\` or \`--mention TEXT\` for a narrower wake. Start one wait with the harness's supported background completion/notification facility; do not spend model turns on timer or status polling. If the harness cannot resume an active turn when that process completes, state that limit instead of inventing a daemon or claiming idle/ended-turn wakeup. Always reread or refocus after resync.

Run \`sideleaf --help\` for the full command and JSON input reference.
`;

function skillError(message: string): Error {
  return Object.assign(new Error(message), { exitCode: 2 });
}

export function skillPath(home: string, target: SkillTarget): string {
  return join(home, ...SKILL_TARGETS[target], "sideleaf", "SKILL.md");
}

export function parseSkillInstallArgs(args: string[]): { targets: SkillTarget[]; force: boolean; home?: string } {
  if (args.shift() !== "install") throw skillError("Usage: sideleaf skills install [--user | --target NAME] [--force]");
  let user = false, target: SkillTarget | undefined, force = false, home: string | undefined;
  while (args.length) {
    const option = args.shift()!;
    if (option === "--user" && !user) user = true;
    else if (option === "--force" && !force) force = true;
    else if (option === "--target" && !target && args.length) {
      const value = args.shift()!;
      if (!(value in SKILL_TARGETS)) throw skillError(`Unsupported skill target: ${value}. Use agents, claude, codex, omp, hermes, or pi.`);
      target = value as SkillTarget;
    } else if (option === "--skill-home" && home === undefined && args.length) {
      home = args.shift()!;
    } else throw skillError(`Invalid skill install option: ${option}`);
  }
  if (user && target) throw skillError("Use either --user or --target, not both.");
  return { targets: user ? Object.keys(SKILL_TARGETS) as SkillTarget[] : [target ?? "agents"], force, ...(home === undefined ? {} : { home }) };
}

function currentFile(path: string): string | null {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw skillError(`${path} exists but is not a regular file. Sideleaf left it unchanged.`);
  return readFileSync(path, "utf8");
}

export function installSideleafSkills(options: { home?: string; targets: SkillTarget[]; force: boolean }): SkillInstallResult[] {
  const home = options.home || homedir();
  if (!home || home.includes("\0")) throw skillError("The skill home directory is invalid.");
  const planned = options.targets.map((target) => {
    const path = skillPath(home, target);
    const current = currentFile(path);
    if (current !== null && current !== SIDELEAF_SKILL && !options.force) {
      throw skillError(`${path} has local changes. Review it, then rerun with --force to replace it.`);
    }
    return { target, path, current };
  });
  return planned.map(({ target, path, current }) => {
    if (current === SIDELEAF_SKILL) return { target, path, status: "unchanged" };
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    if (currentFile(path) !== current) throw skillError(`${path} changed during installation. Sideleaf left the newer file unchanged.`);
    atomicWrite(path, Buffer.from(SIDELEAF_SKILL), 0o644);
    return { target, path, status: current === null ? "installed" : "updated" };
  });
}
