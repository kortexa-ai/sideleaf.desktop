import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentFile } from "../src/document/files.ts";
import { DocumentWorkspace } from "../src/document/workspace.ts";

// Bundle and run with the packaged Cottontail executable on each platform.
// Fixture creation is excluded from timings; the directory remains for UI QA.
const directory = mkdtempSync(join(tmpdir(), "sideleaf-workspace-bench-"));
for (let i = 0; i < 100; i++) {
  const folder = join(directory, `Folder ${i}`); mkdirSync(folder);
  for (let j = 0; j < 100; j++) writeFileSync(join(folder, `Note ${j}.md`), "# A quiet note\n\nOne green leaf.\n");
}
let documentLoads = 0;
const open = DocumentFile.open;
DocumentFile.open = (path: string) => { documentLoads++; return open(path); };
const workspace = new DocumentWorkspace();
const report = (phase: string, start: number, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({
  phase, platform: process.platform, milliseconds: performance.now() - start,
  rssBytes: process.memoryUsage().rss, documentLoads, ...extra,
}));
let start = performance.now(); workspace.openFolder(directory);
report("open-root", start, { directory, totalFiles: 10_000, sessions: workspace.sessions.size });
const root = workspace.root!;
start = performance.now(); const listing = root.list("");
if (listing.error || listing.entries.length !== 100) throw new Error("Root listing failed.");
report("list-root", start, { entries: listing.entries.length });
start = performance.now(); const child = root.list("Folder 0");
if (child.error || child.entries.length !== 100) throw new Error("Child listing failed.");
report("expand-child", start, { entries: child.entries.length });
start = performance.now(); root.watch(["", ...listing.entries.slice(0, 63).map((entry) => entry.key)]);
report("watch-visible", start, { requestedWatchers: 64 });
start = performance.now(); root.watch([]);
report("hide-tree", start, { requestedWatchers: 0 });
if (documentLoads !== 0 || workspace.sessions.size !== 0) throw new Error("Folder browsing loaded document contents.");
workspace.reset();
