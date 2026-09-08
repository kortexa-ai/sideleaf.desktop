import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist/ui", { recursive: true });
await build({
  entryPoints: ["src/ui/app.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["safari17", "chrome120", "firefox120"],
  outdir: "dist/ui",
  minify: true,
  sourcemap: false,
});
await copyFile("src/ui/index.html", "dist/ui/index.html");
await build({ entryPoints: ["src/ui/bootstrap.ts"], bundle: true, format: "iife", platform: "browser", target: ["safari17", "chrome120"], outfile: "dist/ui/bootstrap.js", minify: true });
