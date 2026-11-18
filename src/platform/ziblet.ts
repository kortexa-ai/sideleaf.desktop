import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const ZIBLET_BUNDLE_ID = "ai.kortexa.ziblet.osx";
export type CommandResult = { code: number | null; stdout: string };
export type ZibletEnvironment = { platform?: NodeJS.Platform; home?: () => string; run?: (executable: string, args: string[]) => Promise<CommandResult> };

// A Launch Services query: it sends no Apple event and never starts Ziblet.
const appLookup = `ObjC.import("AppKit"); const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(${JSON.stringify(ZIBLET_BUNDLE_ID)}); url.isNil() ? "" : url.path.js`;

// Rejects only when the command cannot start or overruns; an exit code is a result.
export function runCommand(executable: string, args: string[], timeoutMs = 3_000): Promise<CommandResult> {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let stdout = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${executable} timed out.`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); accept({ code, stdout }); });
  });
}

/** Finds Ziblet's notes folder without reading it, or null. Never throws. */
export async function discoverZiblet({ platform = process.platform, home = homedir, run = runCommand }: ZibletEnvironment = {}): Promise<{ folder: string } | null> {
  if (platform !== "darwin") return null;
  try {
    const app = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", appLookup]);
    if (app.code !== 0 || !app.stdout.trim()) return null;
    // Current Ziblet versions do not write this key yet; they use the default folder.
    const preference = await run("/usr/bin/defaults", ["read", ZIBLET_BUNDLE_ID, "dataFolder"]);
    const value = preference.code === 0 ? preference.stdout.replace(/\r?\n$/, "") : "";
    const folder = isAbsolute(value) && !/[\r\n\0]/.test(value) ? value : join(home(), "kortexa", "ziblet");
    return statSync(folder).isDirectory() ? { folder } : null;
  } catch { return null; }
}
