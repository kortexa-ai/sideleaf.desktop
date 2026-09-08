import { readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

// These three split packs are outside the transitive imports of Sideleaf and
// Electrobun's file, crypto, IPC and FFI paths in the pinned runtime. Keep the
// stream, net and tty packs: Windows Save and lazy stdio can still need them.
// Review this list whenever the runtime or host imports change; never trim an
// unfamiliar SDK. This reduces installed bytes, not the static JSC executable.
const dependencies = JSON.parse(await readFile(".hutch/dependencies.lock", "utf8"));
const versions = new Map(dependencies.objects.map((item) => [item.product, item.version]));
if (versions.get("cottontail") !== "0.6.0-canary.14" || versions.get("electrobun") !== "2.0.2-beta.15") {
  throw new Error("Review Sideleaf's runtime pack list before building with this SDK version.");
}
const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "win" : null;
if (!platform) throw new Error("Runtime trimming is verified only for macOS and Windows.");
const root = join("build", `dev-${platform}-${process.arch}`, process.platform === "darwin" ? "Sideleaf-dev.app" : "Sideleaf-dev");
const bin = join(root, process.platform === "darwin" ? "Contents/MacOS" : "bin");
const resources = join(root, process.platform === "darwin" ? "Contents/Resources" : "Resources");
const source = await readFile(join(resources, "app/bun/index.js"), "utf8");
const parsed = await build({ stdin: { contents: source }, platform: "node", format: "esm", write: false, metafile: true, logLevel: "silent" });
const allowed = new Set(["bun:ffi", "child_process", "crypto", "events", "fs", "os", "path"]);
const imports = Object.values(parsed.metafile.outputs).flatMap((output) => output.imports);
for (const entry of imports) {
  if (!allowed.has(entry.path.replace(/^node:/, ""))) throw new Error(`Review runtime packs for the new host import: ${entry.path}`);
}
let removed = 0;
for (const name of ["http", "tls", "v8"]) {
  const file = join(bin, "cottontail-core/runtime", `${name}.jsc`);
  const size = (await stat(file)).size;
  await unlink(file);
  removed += size;
}
console.info(`Sideleaf omitted ${removed.toLocaleString("en-US")} bytes of unused HTTP, TLS and V8 runtime packs.`);
