import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
if (process.platform !== "win32") throw new Error("Build the Windows installer on Windows.");
const compiler = process.env.SIDELEAF_ISCC ?? resolve("tmp/toolchain/inno/ISCC.exe");
if (!existsSync(compiler)) throw new Error("Install Inno Setup 6.7.3 and set SIDELEAF_ISCC to its ISCC.exe. See docs/releasing.md.");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
execFileSync(compiler, ["/Qp", `/DAppVersion=${version}`, `/DRepoRoot=${resolve(".")}`, "scripts/windows-installer.iss"], { stdio: "inherit" });
