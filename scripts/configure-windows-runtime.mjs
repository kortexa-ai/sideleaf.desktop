import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

if (process.platform !== "win32") process.exit(0);
if (process.arch !== "x64") throw new Error("Sideleaf's Windows launcher is verified only on x64.");
const dependencies = JSON.parse(await readFile(".hutch/dependencies.lock", "utf8"));
const runtime = dependencies.objects.find((entry) => entry.product === "cottontail");
const desktop = dependencies.objects.find((entry) => entry.product === "electrobun");
if (runtime?.revision !== "e5ddf52648c502b1b124ec5f41a9b87b7b9ecedb" || desktop?.version !== "2.0.2-beta.15") {
  throw new Error("Review the Windows stack-limit adapter before changing the desktop runtime.");
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalHash = "abeb0b7889439b3c9d92dd10988bf06c8f2f7744eb60cabdbb1fabea3b1d833b";
const environment = process.env.ELECTROBUN_BUILD_ENV ?? "dev";
if (!["dev", "canary", "stable"].includes(environment)) throw new Error("Unknown build environment.");
const buildDir = resolve("build", `${environment}-win-x64`);
if (process.env.ELECTROBUN_BUILD_DIR && resolve(process.env.ELECTROBUN_BUILD_DIR) !== buildDir) throw new Error("Unexpected Windows build directory.");
const name = environment === "stable" ? "Sideleaf" : `Sideleaf-${environment}`;
const bin = join(buildDir, name, "bin");
const launcher = join(bin, "launcher.exe");
const original = join(bin, "electrobun-launcher.exe");
const currentHash = hash(await readFile(launcher));
if (currentHash !== originalHash) {
  const previous = JSON.parse(await readFile(join(bin, "sideleaf-launcher.json"), "utf8"));
  if (currentHash !== previous.wrapperHash || hash(await readFile(original)) !== originalHash) {
    throw new Error("The Windows launcher differs from the pinned build; rebuild before applying the adapter.");
  }
}

// The compiler is a build tool only. Keep it out of the app and global PATH.
let zig = "zig";
try {
  if (execFileSync(zig, ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "0.16.0") throw new Error("version");
} catch {
  const tools = resolve("tmp/toolchain");
  zig = join(tools, "zig-x86_64-windows-0.16.0/zig.exe");
  try { await access(zig); } catch {
    await mkdir(tools, { recursive: true });
    const response = await fetch("https://ziglang.org/download/0.16.0/zig-x86_64-windows-0.16.0.zip");
    if (!response.ok) throw new Error(`Zig download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== "68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e") throw new Error("Zig archive checksum mismatch.");
    const archive = join(tools, "zig-0.16.0.zip");
    await writeFile(archive, bytes);
    execFileSync("tar.exe", ["-xf", archive, "-C", tools], { stdio: "inherit" });
  }
  if (execFileSync(zig, ["version"], { encoding: "utf8" }).trim() !== "0.16.0") throw new Error("Unexpected cached Zig version.");
}
const output = resolve("tmp/native");
await mkdir(output, { recursive: true });
const resource = join(output, "windows-launcher.res");
const candidate = join(output, "sideleaf-launcher.exe");
const object = join(output, "windows-launcher.obj");
execFileSync(zig, ["rc", "/fo", resource, "src/platform/windows-launcher.rc"], { stdio: "inherit" });
// Use Zig's Windows headers for compilation, then link without a C runtime.
execFileSync(zig, ["cc", "-target", "x86_64-windows-gnu", "-lc", "-c", "-Os", "-Wall", "-Wextra", "-fno-stack-protector", "src/platform/windows-launcher.c", "-o", object], { stdio: "inherit" });
execFileSync(zig, ["cc", "-target", "x86_64-windows-gnu", "-nostdlib", "-s", "-Wl,--entry,sideleafStart", "-Wl,--subsystem,windows", object, resource, "-lkernel32", "-luser32", "-o", candidate], { stdio: "inherit" });
const wrapper = await readFile(candidate);
if (currentHash === originalHash) await copyFile(launcher, original);
await writeFile(join(bin, "sideleaf-launcher.json"), JSON.stringify({ originalHash, wrapperHash: hash(wrapper) }) + "\n");
await copyFile(candidate, join(bin, "launcher.next.exe"));
await rename(join(bin, "launcher.next.exe"), launcher);
console.info(`Sideleaf configured its Windows runtime with a ${wrapper.length.toLocaleString("en-US")}-byte native launcher.`);
