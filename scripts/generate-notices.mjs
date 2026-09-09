import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const licenses = JSON.parse(execFileSync(process.execPath, ["pm", "licenses", "--prod", "--json"], { encoding: "utf8" }));
const directories = Object.values(licenses).flat().flatMap((entry) => entry.paths).sort((a, b) => a.localeCompare(b));
const sources = JSON.parse(await readFile("scripts/third-party-sources.json", "utf8"));
const sections = ["Sideleaf — third-party copyright and license notices\n\nSideleaf's MIT license does not replace these component licenses.\nSee THIRD_PARTY_NOTICES.md for corresponding source and relinking information."];
const mit = (await readFile("LICENSE", "utf8")).replace("Copyright (c) 2026 Franci Penov", "Copyright (c) Blackboard Technologies Inc.");
sections.push(`Cottontail 0.6.0-canary.14 and zig-asar 0.2.7\n\nTheir pinned package.json files declare MIT and Blackboard Technologies Inc. as author.\n\n${mit}`);

for (const directory of directories) {
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const files = (await readdir(directory)).filter((name) => /^(license|copying|notice)([.-]|$)/i.test(name)).sort();
  if (!files.length) throw new Error(`Missing license for ${pkg.name}`);
  sections.push(`${pkg.name} ${pkg.version} (${pkg.license})\n\n${(await Promise.all(files.map((name) => readFile(join(directory, name), "utf8")))).join("\n\n")}`);
}

await mkdir("tmp/license-texts", { recursive: true });
for (const source of sources.licenses) {
  const cache = join("tmp/license-texts", `${source.sha256}.txt`);
  let bytes;
  try { bytes = await readFile(cache); } catch {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`License download failed for ${source.name}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (source.archiveMember) {
      const archive = join("tmp/license-texts", `${source.sha256}.archive`);
      await writeFile(archive, bytes);
      bytes = execFileSync("tar", ["-xOf", archive, source.archiveMember], { maxBuffer: 1024 * 1024 });
    }
    if (hash(bytes) !== source.sha256) throw new Error(`License checksum mismatch for ${source.name}`);
    await writeFile(cache, bytes);
  }
  if (hash(bytes) !== source.sha256) throw new Error(`Cached license checksum mismatch for ${source.name}`);
  sections.push(`${source.name}\nSource: ${source.url}\n\n${bytes.toString("utf8")}`);
}
for (const notice of sources.sourceNotices) {
  sections.push(`${notice.component}\nSource: https://github.com/WebKit/WebKit/blob/${notice.revision}/${notice.path}\n\n${notice.text}`);
}
await mkdir("licenses", { recursive: true });
await writeFile("licenses/third-party.txt", sections.join("\n\n" + "=".repeat(72) + "\n\n") + "\n");
console.info(`Recorded ${sections.length - 1} third-party license sections.`);
