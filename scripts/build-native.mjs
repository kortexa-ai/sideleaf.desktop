import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

await mkdir("dist/native", { recursive: true });
if (process.platform === "darwin") {
  execFileSync("xcrun", ["clang", "-Os", "-Wall", "-Wextra", "src/platform/cli-launcher.c", "-o", "dist/native/sideleaf"], { stdio: "inherit" });
  execFileSync("xcrun", ["swiftc", "-O", "-emit-library", "-module-name", "SideleafDialogs", "src/platform/save-dialog.swift", "-o", "dist/native/libSideleafDialogs.dylib"], { stdio: "inherit" });
}
