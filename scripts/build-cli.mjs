import { build } from "esbuild";
import { chmod } from "node:fs/promises";
await build({ entryPoints: ["src/cli.ts"], outfile: "dist/cli/sideleaf.mjs", bundle: true, platform: "node", target: "node24", format: "esm" });
await chmod("dist/cli/sideleaf.mjs", 0o755);
