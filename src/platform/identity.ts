import { copyFileSync, existsSync, mkdirSync, constants } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import * as Utils from "electrobun/main/utils";
import { RESOURCES_FOLDER } from "electrobun/main/paths";

// Only this preference file is app-owned persistent state today. Keep legacy
// data and logs intact, and never replace preferences already in the new root.
export function migrateIdentityData() {
  const current = join(Utils.paths.userData, "updates.json");
  const legacy = current.replace(`${sep}ai.kortexa.sideleaf${sep}`, `${sep}xyz.sideleaf.desktop${sep}`);
  if (legacy !== current && !existsSync(current) && existsSync(legacy)) {
    mkdirSync(dirname(current), { recursive: true });
    try { copyFileSync(legacy, current, constants.COPYFILE_EXCL); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
}

export async function windowsIdentity() {
  if (process.platform !== "win32") return () => 0;
  const { dlopen, FFIType } = await import("bun:ffi");
  const library = dlopen(join(RESOURCES_FOLDER, "app/native/sideleaf-identity.dll"), {
    sideleaf_identity: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  });
  const launcher = Buffer.from(`${resolve(RESOURCES_FOLDER, "../bin/launcher.exe")}\0`, "utf16le");
  const id = Buffer.from(`ai.kortexa.sideleaf${Utils.paths.userData.endsWith(`${sep}stable`) ? "" : ".dev"}\0`, "utf16le");
  library.symbols.sideleaf_identity(launcher, id, 0);
  return () => library.symbols.sideleaf_identity(launcher, id, 1);
}
