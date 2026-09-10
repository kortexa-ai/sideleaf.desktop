import { describe, expect, test } from "bun:test";
import { customShortcutAccelerator, customShortcutAction, customShortcutLabel, saveAsAccelerator, type ShortcutEvent } from "../src/ui/shortcuts.ts";

const event = (overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  altKey: false,
  code: "KeyD",
  ctrlKey: false,
  isComposing: false,
  key: "d",
  metaKey: false,
  shiftKey: false,
  ...overrides,
});

describe("custom shortcuts", () => {
  test("uses Command-Shift for every Sideleaf-specific macOS action", () => {
    const expected = { KeyD: "distractionFree", KeyW: "modeWrite", KeyS: "modeSplit", KeyR: "modeRead", KeyC: "comment" } as const;
    for (const [code, action] of Object.entries(expected)) {
      expect(customShortcutAction("macos", event({ code, key: code.slice(3).toLowerCase(), metaKey: true, shiftKey: true }))).toBe(action);
    }
  });

  test("rejects the old macOS Option chord and extra modifiers", () => {
    expect(customShortcutAction("macos", event({ metaKey: true, altKey: true }))).toBeNull();
    expect(customShortcutAction("macos", event({ metaKey: true, shiftKey: true, altKey: true }))).toBeNull();
    expect(customShortcutAction("macos", event({ metaKey: true, shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(customShortcutAction("macos", event({ metaKey: true, shiftKey: true, isComposing: true }))).toBeNull();
    expect(customShortcutAction("macos", event({ metaKey: true, shiftKey: true, code: "KeyM", key: "m" }))).toBeNull();
  });

  test("keeps Windows on Control-Alt", () => {
    expect(customShortcutAction("windows", event({ ctrlKey: true, altKey: true, code: "KeyS", key: "s" }))).toBe("modeSplit");
    expect(customShortcutAction("windows", event({ ctrlKey: true, shiftKey: true, code: "KeyS", key: "s" }))).toBeNull();
  });

  test("keeps Split distinct from Save and Save As in native menus", () => {
    expect(customShortcutAccelerator("darwin", "s")).toBe("CmdOrCtrl+Shift+S");
    expect(saveAsAccelerator("darwin")).toBeNull();
    expect(customShortcutAccelerator("win32", "s")).toBe("CmdOrCtrl+Alt+S");
    expect(saveAsAccelerator("win32")).toBe("CmdOrCtrl+Shift+S");
  });

  test("shows the platform chord used by custom shortcut bindings", () => {
    expect(customShortcutLabel("macos", "d")).toBe("⌘⇧D");
    expect(customShortcutLabel("windows", "d")).toBe("Ctrl+Alt+D");
    expect(customShortcutLabel("linux", "d")).toBe("");
  });
});
