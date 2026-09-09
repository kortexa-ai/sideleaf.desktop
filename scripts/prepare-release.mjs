import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function macDiskImage() {
  const identity = process.env.ELECTROBUN_DEVELOPER_ID;
  if (!identity) throw new Error("ELECTROBUN_DEVELOPER_ID is required for a Mac release.");
  const run = (command, args) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const work = await mkdtemp(resolve("tmp/release-macos-"));
  const payload = join(work, "payload");
  await mkdir(payload);
  const app = join(payload, "Sideleaf.app");
  run("tar", ["-xf", resolve("artifacts/stable-macos-arm64-Sideleaf.app.tar.zst"), "-C", payload]);

  // Hutch signs the inner app before compression. Its tar/self-extraction path
  // loses extended-attribute signatures on generic .jsc files. Restore those
  // signatures and the app seal, then distribute the real app on an APFS DMG.
  // Mach-O files keep their original hardened-runtime signatures and entitlements.
  for (const entry of await readdir(join(app, "Contents/MacOS"), { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsc")) {
      run("codesign", ["--force", "--timestamp", "--sign", identity, join(entry.parentPath, entry.name)]);
    }
  }
  run("codesign", ["--force", "--options", "runtime", "--timestamp", "--entitlements", resolve("build/stable-macos-arm64/entitlements.plist"), "--sign", identity, app]);
  run("codesign", ["--verify", "--deep", "--strict", app]);

  const notarize = (file) => {
    const result = JSON.parse(run("xcrun", ["notarytool", "submit", file, "--keychain-profile", "notarytool", "--wait", "--output-format", "json"]));
    if (result.status !== "Accepted") throw new Error(`Notarization failed: ${result.id} (${result.status}).`);
    run("xcrun", ["stapler", "staple", file]);
    run("xcrun", ["stapler", "validate", file]);
    console.info(`Notarized ${file.endsWith(".dmg") ? "disk image" : "app"}: ${result.id}`);
  };
  const zip = join(work, "Sideleaf.zip");
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  // Apple accepts the ZIP submission; the ticket is stapled to the enclosed app.
  const appResult = JSON.parse(run("xcrun", ["notarytool", "submit", zip, "--keychain-profile", "notarytool", "--wait", "--output-format", "json"]));
  if (appResult.status !== "Accepted") throw new Error(`App notarization failed: ${appResult.id} (${appResult.status}).`);
  run("xcrun", ["stapler", "staple", app]);
  run("xcrun", ["stapler", "validate", app]);
  console.info(`Notarized app: ${appResult.id}`);
  await symlink("/Applications", join(payload, "Applications"));
  const dmg = join(work, "Sideleaf.dmg");
  run("hdiutil", ["create", "-volname", "Sideleaf", "-srcfolder", payload, "-format", "UDZO", "-fs", "APFS", dmg]);
  run("codesign", ["--force", "--timestamp", "--sign", identity, dmg]);
  notarize(dmg);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
  run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg]);
  return dmg;
}

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = (await readFile("src/shared/version.ts", "utf8")).match(/APP_VERSION = "([0-9.]+)"/)?.[1];
if (!version || pkg.version !== version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Release versions do not match.");
const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : null;
if ((platform === "macos" && process.arch !== "arm64") || (platform === "windows" && process.arch !== "x64") || !platform) {
  throw new Error("This release supports native macOS arm64 and Windows x64 builds.");
}
if (platform === "windows") {
  execFileSync(process.execPath, ["scripts/build-windows-installer.mjs"], { stdio: "inherit" });
  const archive = resolve("artifacts", "win-x64-Sideleaf-Setup.zip");
  const installer = resolve("artifacts/release", `Sideleaf-${version}-windows-x64-setup.exe`);
  const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -LiteralPath ${literal(installer)} -DestinationPath ${literal(archive)} -Force`], { stdio: "inherit" });
}
const source = platform === "macos" ? await macDiskImage() : join("artifacts", "win-x64-Sideleaf-Setup.zip");
const target = platform === "macos" ? `Sideleaf-${version}-macos-arm64.dmg` : `Sideleaf-${version}-windows-x64-setup.zip`;
const output = "artifacts/release";
await mkdir(output, { recursive: true });
await copyFile(source, join(output, target));
const bytes = await readFile(join(output, target));
const checksum = createHash("sha256").update(bytes).digest("hex");
await writeFile(join(output, `SHA256SUMS-${platform}.txt`), `${checksum}  ${target}\n`);
await copyFile("licenses/third-party.txt", join(output, `Sideleaf-${version}-THIRD-PARTY-NOTICES.txt`));
console.info(`${target}: ${bytes.length.toLocaleString("en-US")} bytes; SHA-256 ${checksum}`);
