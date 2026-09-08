import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = (await readFile("src/shared/version.ts", "utf8")).match(/APP_VERSION = "([0-9.]+)"/)?.[1];
if (!version || pkg.version !== version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Release versions do not match.");
const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : null;
if ((platform === "macos" && process.arch !== "arm64") || (platform === "windows" && process.arch !== "x64") || !platform) {
  throw new Error("This release supports native macOS arm64 and Windows x64 builds.");
}
const source = platform === "macos" ? "macos-arm64-Sideleaf.dmg" : "win-x64-Sideleaf-Setup.zip";
const target = platform === "macos" ? `Sideleaf-${version}-macos-arm64.dmg` : `Sideleaf-${version}-windows-x64-setup.zip`;
const output = "artifacts/release";
await mkdir(output, { recursive: true });
await copyFile(join("artifacts", source), join(output, target));
const bytes = await readFile(join(output, target));
const checksum = createHash("sha256").update(bytes).digest("hex");
await writeFile(join(output, `SHA256SUMS-${platform}.txt`), `${checksum}  ${target}\n`);
await copyFile("licenses/third-party.txt", join(output, `Sideleaf-${version}-THIRD-PARTY-NOTICES.txt`));
console.info(`${target}: ${bytes.length.toLocaleString("en-US")} bytes; SHA-256 ${checksum}`);
