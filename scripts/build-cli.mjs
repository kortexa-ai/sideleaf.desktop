import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
await rm("dist/cli", { recursive: true, force: true });
await mkdir("dist/cli", { recursive: true });
// Cottontail implements these Node-compatible APIs; Node is only a build tool.
await build({ entryPoints: ["src/cli.ts"], outfile: "dist/cli/sideleaf.mjs", bundle: true, platform: "node", target: "es2022", format: "esm", external: ["bun:ffi"] });
for (const [source, target] of [["scripts/install-cli.ps1", "install-cli.ps1"], ["scripts/install-cli.sh", "install-cli.sh"], ["src/platform/install-cli-wsl.sh", "install-cli-wsl.sh"]]) await copyFile(source, `dist/cli/${target}`);
