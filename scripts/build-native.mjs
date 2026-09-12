import { access, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

await mkdir("dist/native", { recursive: true });
if (process.platform === "darwin") {
  execFileSync("xcrun", ["clang", "-Os", "-Wall", "-Wextra", "src/platform/cli-launcher.c", "-o", "dist/native/sideleaf"], { stdio: "inherit" });
  execFileSync("xcrun", ["swiftc", "-O", "-emit-library", "-module-name", "SideleafDialogs", "src/platform/save-dialog.swift", "-o", "dist/native/libSideleafDialogs.dylib"], { stdio: "inherit" });
}
if (process.platform === "win32") {
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
  // A tiny protocol-agnostic bridge supplies named-pipe peer process/SID
  // verification and private channel ACLs that node:net cannot expose.
  execFileSync(zig, ["cc", "-target", "x86_64-windows-gnu", "-municode", "-Os", "-Wall", "-Wextra",
    "src/platform/windows-channel.c", "-ladvapi32", "-lshell32", "-o", "dist/native/sideleaf-channel.exe"], { stdio: "inherit" });
  execFileSync(zig, ["cc", "-target", "x86_64-windows-gnu", "-shared", "-Os", "-Wall", "-Wextra",
    "src/platform/windows-channel.c", "-ladvapi32", "-lshell32", "-o", "dist/native/sideleaf-channel.dll"], { stdio: "inherit" });
}
