import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
if (process.platform !== "win32") throw new Error("Build the Windows installer on Windows.");
const compiler = process.env.SIDELEAF_ISCC ?? resolve("tmp/toolchain/inno/ISCC.exe");
if (!existsSync(compiler)) throw new Error("Install Inno Setup 6.7.3 and set SIDELEAF_ISCC to its ISCC.exe. See docs/releasing.md.");
const staging = mkdtempSync(resolve("tmp/windows-installer-"));
execFileSync("tar.exe", ["-xf", resolve("artifacts/stable-win-x64-Sideleaf.tar.zst"), "-C", staging], { stdio: "inherit" });
const payload = resolve(staging, "Sideleaf");
if (!existsSync(resolve(payload, "bin/sideleaf.exe"))) throw new Error("The inner app is missing its CLI.");
// Electrobun stamps its icon after postBuild, which replaces the launcher's other
// resources. Restore the already-built native launcher before Inno reads the payload.
const nativeLauncher = resolve("tmp/native/sideleaf-launcher.exe");
const launcherManifest = JSON.parse(readFileSync(resolve(payload, "bin/sideleaf-launcher.json"), "utf8"));
const nativeLauncherHash = createHash("sha256").update(readFileSync(nativeLauncher)).digest("hex");
if (nativeLauncherHash !== launcherManifest.wrapperHash) throw new Error("The native Windows launcher does not match this build.");
copyFileSync(nativeLauncher, resolve(payload, "bin/launcher.exe"));
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
execFileSync(compiler, ["/Qp", `/DAppVersion=${version}`, `/DRepoRoot=${resolve(".")}`, `/DPayloadDir=${payload}`, "scripts/windows-installer.iss"], { stdio: "inherit" });
