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
description: Use Sideleaf's local CLI to read, author, edit, and review Markdown files with portable embedded comments.
---

# Work with Markdown in Sideleaf

Use Sideleaf for local Markdown work when comments or revision-safe edits need to remain in the same portable file. It does not require a running Sideleaf window or network access.

Sideleaf stores review metadata in a terminal HTML comment. Do not edit that block by hand. Use the CLI so the visible Markdown, comment anchors, and retained revision data stay consistent.

## Read before writing

Run \`sideleaf read FILE\` to get the visible text, comments, and current revision as JSON. Run \`sideleaf comments FILE\` when only the current comments are needed.

Before every CLI write, read the file again and pass that exact revision with \`--if-revision HASH\`. Pass a clear identity such as \`--actor agent:reviewer\`. If a write exits with code 3, the file changed or another Sideleaf writer has it locked. Read again, reconsider the edit against the new text, and do not blindly retry.

## Author and edit

Create a new file as ordinary UTF-8 Markdown with the available file-writing tool. Then use \`sideleaf read FILE\` before adding comments or making later revision-checked edits.

For an existing file, send a zero-based, end-exclusive UTF-16 range and replacement text as JSON:

\`\`\`sh
sideleaf edit FILE --if-revision HASH --actor agent:reviewer <<'JSON'
{"from":0,"to":0,"text":"# Notes\\n\\n"}
JSON
\`\`\`

Use offsets from the logical LF text returned by \`sideleaf read\`. Never count bytes, and never split a Unicode surrogate pair.

## Review comments

Add a comment to an exact source range:

\`\`\`sh
sideleaf comment-add FILE --if-revision HASH --actor agent:reviewer <<'JSON'
{"from":2,"to":7,"body":"Please check this wording."}
JSON
\`\`\`

Use \`sideleaf comment-update\` or \`sideleaf comment-remove\` with the current revision and the comment ID. Read the document again after every write because the revision changes.

To read human responses, run \`sideleaf comments FILE\` again after the human saves. The current release has flat comments, not threads or resolve/reopen state. Do not invent reply or resolve commands. Add a new anchored comment when a separate response is useful, or update an existing comment only when the user asked for that change.

Run \`sideleaf --help\` for the full command and JSON input reference.
`;

function skillError(message: string): Error {
  return Object.assign(new Error(message), { exitCode: 2 });
}

export function skillPath(home: string, target: SkillTarget): string {
  return join(home, ...SKILL_TARGETS[target], "sideleaf", "SKILL.md");
}

export function parseSkillInstallArgs(args: string[]): { targets: SkillTarget[]; force: boolean } {
  if (args.shift() !== "install") throw skillError("Usage: sideleaf skills install [--user | --target NAME] [--force]");
  let user = false, target: SkillTarget | undefined, force = false;
  while (args.length) {
    const option = args.shift()!;
    if (option === "--user" && !user) user = true;
    else if (option === "--force" && !force) force = true;
    else if (option === "--target" && !target && args.length) {
      const value = args.shift()!;
      if (!(value in SKILL_TARGETS)) throw skillError(`Unsupported skill target: ${value}. Use agents, claude, codex, omp, hermes, or pi.`);
      target = value as SkillTarget;
    } else throw skillError(`Invalid skill install option: ${option}`);
  }
  if (user && target) throw skillError("Use either --user or --target, not both.");
  return { targets: user ? Object.keys(SKILL_TARGETS) as SkillTarget[] : [target ?? "agents"], force };
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
