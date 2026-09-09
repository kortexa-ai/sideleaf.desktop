import { build } from "esbuild";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
await build({ entryPoints: ["src/cli.ts"], outfile: "dist/cli/sideleaf.mjs", bundle: true, platform: "node", target: "node24", format: "esm" });
await chmod("dist/cli/sideleaf.mjs", 0o755);
const app = JSON.parse(await readFile("package.json", "utf8"));
// The distributable is already bundled. Keep desktop dependencies out of CLI
// installation so this archive also installs offline in each WSL distribution.
await writeFile("dist/cli/package.json", JSON.stringify({ name: app.name, version: app.version, type: "module", description: "Sideleaf agent CLI", license: app.license, engines: app.engines, bin: { sideleaf: "sideleaf.mjs" }, files: ["sideleaf.mjs", "install-cli.ps1", "install-cli.sh", "README.md", "LICENSE"] }, null, 2) + "\n");
for (const [source, target] of [["scripts/install-cli.ps1", "install-cli.ps1"], ["scripts/install-cli.sh", "install-cli.sh"], ["docs/cli.md", "README.md"], ["LICENSE", "LICENSE"]]) await copyFile(source, `dist/cli/${target}`);
await mkdir("artifacts/release", { recursive: true });
