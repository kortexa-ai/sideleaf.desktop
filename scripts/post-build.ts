import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Run before Hutch signs, compresses, and wraps the final application.
// The same mutations must be present inside both platform installers.
const buildDirectory = process.env.ELECTROBUN_BUILD_DIR;
if (!buildDirectory) throw new Error("This hook must run through the Electrobun builder.");
const wrapper = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
const name = process.env.ELECTROBUN_BUILD_ENV === "stable" ? "Sideleaf" : `Sideleaf-${process.env.ELECTROBUN_BUILD_ENV}`;
const root = wrapper ?? join(buildDirectory, process.platform === "darwin" ? `${name}.app` : name);
if (!wrapper) {
  for (const script of ["scripts/trim-runtime.mjs", "scripts/configure-windows-runtime.mjs"]) {
    execFileSync("node", [script], { stdio: "inherit" });
  }

  // Older system ICU versions need this data. Bundle it so first launch works
  // offline and the runtime never needs its compatibility-data download.
  const checksum = "672dafc4940a0183cb48c3e369c1a0795cc8dfbf19951c86ced0ad78398f9480";
  const cache = join("tmp", "runtime-data", "icudt70l.dat");
  let data: Uint8Array;
  if (existsSync(cache)) data = readFileSync(cache);
  else {
    const response = await fetch("https://electrobun-artifacts.blackboard.sh/jsc/icu/70.1/icudt70l.dat");
    if (!response.ok) throw new Error("Could not download the pinned ICU data.");
    data = new Uint8Array(await response.arrayBuffer());
  }
  if (data.byteLength !== 29_466_000 || createHash("sha256").update(data).digest("hex") !== checksum) {
    throw new Error("The pinned ICU data checksum does not match.");
  }
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, data);
  const destination = join(root, ...(process.platform === "darwin" ? ["Contents"] : []), "share", "cottontail", "icu", "70.1", "icudt70l.dat");
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, data);
}
if (process.platform === "darwin") {
  // This is the actual minimum encoded in the pinned Cottontail Mach-O binary.
  const plist = join(root, "Contents", "Info.plist");
  const buddy = "/usr/libexec/PlistBuddy";
  const value = "LSMinimumSystemVersion";
  let present = false;
  try { execFileSync(buddy, ["-c", `Print :${value}`, plist], { stdio: "ignore" }); present = true; } catch { /* Add a missing key. */ }
  execFileSync(buddy, ["-c", present ? `Set :${value} 26.6.2` : `Add :${value} string 26.6.2`, plist]);
}
