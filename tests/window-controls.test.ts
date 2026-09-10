import { expect, test } from "bun:test";
import { handleWindowAction } from "../src/platform/window-controls.ts";

test("window actions restore maximized windows and close through the cancellable native path", () => {
  const calls: string[] = [];
  let maximized = false;
  const win = {
    minimize() { calls.push("minimize"); },
    isMaximized() { return maximized; },
    maximize() { maximized = true; calls.push("maximize"); },
    unmaximize() { maximized = false; calls.push("restore"); },
    setFullScreen(fullScreen: boolean) { calls.push(fullScreen ? "fullscreen" : "windowed"); },
    requestClose() { calls.push("close"); },
  };
  for (const action of ["minimize", "toggle-maximize", "toggle-maximize", "enter-distraction-free", "exit-distraction-free", "close"]) {
    expect(handleWindowAction(win, action)).toBe(true);
  }
  expect(calls).toEqual(["minimize", "maximize", "restore", "fullscreen", "windowed", "close"]);
  for (const action of [null, {}, "quit", "setFrame", undefined]) {
    expect(() => handleWindowAction(win, action)).toThrow("Unknown window action");
  }
  expect(calls).toHaveLength(6);
  expect(() => handleWindowAction(null, "close")).toThrow("unavailable");
});

test("move and system menu require the native Windows chrome adapter", () => {
  const calls: string[] = [];
  const win = { minimize() {}, isMaximized: () => false, maximize() {}, unmaximize() {}, setFullScreen() {}, requestClose() {} };
  expect(() => handleWindowAction(win, "move")).toThrow("Native Windows chrome is unavailable");
  expect(handleWindowAction(win, "move", (action) => calls.push(action))).toBe(true);
  expect(handleWindowAction(win, "system-menu", (action) => calls.push(action))).toBe(true);
  expect(calls).toEqual(["move", "system-menu"]);
});
