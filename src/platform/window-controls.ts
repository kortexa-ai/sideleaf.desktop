import type { WindowsChrome } from "./windows-chrome.ts";

export type WindowAction = "minimize" | "toggle-maximize" | "close" | "move" | "system-menu";

type AppWindow = {
  minimize(): unknown;
  isMaximized(): boolean;
  maximize(): unknown;
  unmaximize(): unknown;
  requestClose(): unknown;
};

// Called only after the typed webview bridge validates the request shape.
export function handleWindowAction(win: AppWindow | null, action: unknown, chrome?: WindowsChrome): boolean {
  if (action !== "minimize" && action !== "toggle-maximize" && action !== "close" && action !== "move" && action !== "system-menu") {
    throw new Error("Unknown window action.");
  }
  if (!win) throw new Error("Sideleaf window is unavailable.");
  if (action === "move" || action === "system-menu") {
    if (!chrome) throw new Error("Native Windows chrome is unavailable.");
    chrome(action);
  }
  if (action === "minimize") win.minimize();
  if (action === "toggle-maximize") {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
  // Use the same cancellable will-close path as native controls and Alt+F4.
  if (action === "close") win.requestClose();
  return true;
}
