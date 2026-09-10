import type { Command } from "../shared/contracts.ts";

export type ShortcutPlatform = "macos" | "windows" | "linux";
export type ShortcutEvent = {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
};

const customCommands: Readonly<Record<string, Command>> = {
  w: "modeWrite",
  s: "modeSplit",
  r: "modeRead",
  c: "comment",
  d: "distractionFree",
};

export function customShortcutAction(platform: ShortcutPlatform, event: ShortcutEvent): Command | null {
  if (event.isComposing || platform === "linux") return null;
  const macChord = platform === "macos" && event.metaKey && !event.ctrlKey && event.shiftKey && !event.altKey;
  const windowsChord = platform === "windows" && event.ctrlKey && !event.metaKey && event.altKey && !event.shiftKey;
  if (!macChord && !windowsChord) return null;
  const key = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  return customCommands[key] ?? null;
}

export function customShortcutLabel(platform: ShortcutPlatform, key: string): string {
  const letter = key.toUpperCase();
  if (platform === "macos") return `⌘⇧${letter}`;
  if (platform === "windows") return `Ctrl+Alt+${letter}`;
  return "";
}

export function customShortcutAccelerator(platform: NodeJS.Platform, key: string): string {
  const modifier = platform === "darwin" ? "CmdOrCtrl+Shift" : "CmdOrCtrl+Alt";
  return `${modifier}+${key.toUpperCase()}`;
}

// Command-Shift-S belongs to Split on macOS. Save As remains available in
// the File menu there, while Windows retains its familiar Ctrl-Shift-S chord.
export function saveAsAccelerator(platform: NodeJS.Platform): string | null {
  return platform === "darwin" ? null : "CmdOrCtrl+Shift+S";
}
