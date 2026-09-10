import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { installSideleafSkills, parseSkillInstallArgs, SIDELEAF_SKILL, SKILL_TARGETS, skillPath } from "../src/skill.ts";

const home = () => mkdtempSync(join(tmpdir(), "sideleaf-skills-"));

test("the default install creates a valid self-contained Sideleaf skill", () => {
  const root = home();
  const [result] = installSideleafSkills({ home: root, targets: ["agents"], force: false });
  assert.deepEqual(result, { target: "agents", path: skillPath(root, "agents"), status: "installed" });
  const text = readFileSync(result!.path, "utf8");
  assert.equal(text, SIDELEAF_SKILL);
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter);
  assert.match(frontmatter[1]!, /^name: sideleaf$/m);
  assert.match(frontmatter[1]!, /^description: \S.+$/m);
  assert.match(text, /sideleaf read FILE/);
  assert.match(text, /--if-revision HASH/);
  assert.match(text, /flat comments, not threads/);
  assert.equal(readdirSync(dirname(result!.path)).join(","), "SKILL.md");
});

test("target selection covers one target or every supported user target", () => {
  assert.deepEqual(parseSkillInstallArgs(["install"]), { targets: ["agents"], force: false });
  assert.deepEqual(parseSkillInstallArgs(["install", "--target", "pi", "--force"]), { targets: ["pi"], force: true });
  assert.deepEqual(parseSkillInstallArgs(["install", "--user"]).targets, Object.keys(SKILL_TARGETS));
  assert.throws(() => parseSkillInstallArgs(["install", "--user", "--target", "codex"]), /either --user or --target/);
  assert.throws(() => parseSkillInstallArgs(["install", "--target", "other"]), /agents, claude, codex, omp, hermes, or pi/);

  const root = home();
  const results = installSideleafSkills({ home: root, targets: Object.keys(SKILL_TARGETS) as (keyof typeof SKILL_TARGETS)[], force: false });
  assert.equal(results.length, 6);
  for (const result of results) assert.equal(readFileSync(result.path, "utf8"), SIDELEAF_SKILL);
});

test("reinstall is idempotent and local changes require explicit replacement", () => {
  const root = home(), path = skillPath(root, "codex");
  assert.equal(installSideleafSkills({ home: root, targets: ["codex"], force: false })[0]!.status, "installed");
  assert.equal(installSideleafSkills({ home: root, targets: ["codex"], force: false })[0]!.status, "unchanged");
  writeFileSync(path, "user customization\n");
  assert.throws(() => installSideleafSkills({ home: root, targets: ["codex"], force: false }), /--force/);
  assert.equal(readFileSync(path, "utf8"), "user customization\n");
  assert.equal(installSideleafSkills({ home: root, targets: ["codex"], force: true })[0]!.status, "updated");
  assert.equal(readFileSync(path, "utf8"), SIDELEAF_SKILL);
});

test("a conflicting user target is found before any other target is installed", () => {
  const root = home(), conflict = skillPath(root, "codex");
  mkdirSync(dirname(conflict), { recursive: true }); writeFileSync(conflict, "keep me\n");
  assert.throws(() => installSideleafSkills({ home: root, targets: Object.keys(SKILL_TARGETS) as (keyof typeof SKILL_TARGETS)[], force: false }), /local changes/);
  assert.equal(existsSync(skillPath(root, "agents")), false);
  assert.equal(readFileSync(conflict, "utf8"), "keep me\n");
});

test("the CLI returns target paths as JSON and the WSL wrapper selects its Linux home", () => {
  const root = home();
  const result = spawnSync(process.execPath, [resolve("src/cli.ts"), "skills", "install", "--target", "hermes"], {
    encoding: "utf8", env: { ...process.env, SIDELEAF_SKILLS_HOME: root },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, true); assert.equal(data.targets[0].target, "hermes");
  assert.equal(data.targets[0].path, skillPath(root, "hermes"));
  const wrapper = readFileSync(new URL("../src/platform/install-cli-wsl.sh", import.meta.url), "utf8");
  assert.match(wrapper, /SIDELEAF_SKILLS_HOME="\$HOME"/);
  assert.match(wrapper, /SIDELEAF_SKILLS_HOME\/p/);
});
