import { BrowserWindow } from "electrobun/main/browser-window";
import { BrowserView } from "electrobun/main/browser-view";
import * as ApplicationMenu from "electrobun/main/app-menu";
import * as Utils from "electrobun/main/utils";
import events from "electrobun/main/events";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DocumentFile } from "./document/files.ts";
import { SaveTransfer } from "./document/save-transfer.ts";
import { defaultWSLDistro, installCommandLineTool, installWSLCommand } from "./platform/cli-install.ts";
import { chooseSavePath } from "./platform/dialogs.ts";
import { handleWindowAction } from "./platform/window-controls.ts";
import { loadWindowsChrome, type WindowsChrome } from "./platform/windows-chrome.ts";
import { documentMetadata, type Command, type SideleafRPC } from "./shared/contracts.ts";
import { APP_VERSION } from "./shared/version.ts";
import { UpdateChecker } from "./updates.ts";

import { migrateIdentityData, windowsIdentity } from "./platform/identity.ts";

migrateIdentityData();
const configureWindowsIdentity = await windowsIdentity();
const configureWindowsChrome = await loadWindowsChrome();
const macDoubleClick = (() => {
  if (process.platform !== "darwin") return "Maximize";
  try { return execFileSync("defaults", ["read", "-g", "AppleActionOnDoubleClick"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "Maximize"; }
})();
let windowsChrome: WindowsChrome | undefined;

const launchTime = performance.now();
const startupLog = join(Utils.paths.userLogs, "startup.jsonl");
try { mkdirSync(Utils.paths.userLogs, { recursive: true }); writeFileSync(startupLog, "", { mode: 0o600 }); } catch { /* Diagnostics must not prevent startup. */ }
function diagnostic(event: string, message: string) {
  const record = { event, message: message.slice(0, 1000), millisecondsFromHost: Math.round(performance.now() - launchTime), platform: process.platform };
  console.info(JSON.stringify(record));
  try { appendFileSync(startupLog, `${JSON.stringify(record)}\n`); } catch { /* Keep the app usable if its log directory is read-only. */ }
}
diagnostic("host-started", `Sideleaf ${APP_VERSION}`);
const openArgument = process.argv.indexOf("--sideleaf-open");
const initialPath = process.env.SIDELEAF_OPEN_PATH ?? (openArgument >= 0 ? process.argv[openArgument + 1] : undefined);
let document = initialPath ? DocumentFile.open(initialPath) : new DocumentFile();
const saveTransfer = new SaveTransfer();
let dirty = false;
let approvedClose = false;
let dialogOpen = false;
let updateChecksStarted = false;
let appWindow: BrowserWindow;

function checkId(id: string) {
  if (typeof id !== "string" || id !== document.id) throw new Error("This request belongs to an earlier document. Please try again.");
}

const rpc = BrowserView.defineRPC<SideleafRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      initial: () => { diagnostic("initial-document", "Requested"); return document.snapshot(); },
      cliAvailability: async () => ({ wslDistro: await defaultWSLDistro() }),
      installCLI: ({ wsl }) => installCLI(wsl === true),
      updateState: () => updates.snapshot(),
      checkUpdates: () => updates.check(true),
      dismissUpdate: () => updates.dismiss(),
      openDefaultApps: () => {
        if (process.platform !== "win32") throw new Error("Default Apps is available on Windows only.");
        return Utils.openExternal("ms-settings:defaultapps");
      },
      open: async () => {
        const paths = await Utils.openFileDialog({ allowedFileTypes: "md,markdown,mdown,txt", canChooseDirectory: false, allowsMultipleSelection: false });
        if (!paths[0]) return null;
        const next = DocumentFile.open(paths[0]);
        document = next; saveTransfer.clear(); dirty = false; updateTitle();
        return document.snapshot();
      },
      newDocument: () => { document = new DocumentFile(); saveTransfer.clear(); dirty = false; updateTitle(); return document.snapshot(); },
      stageSave: (part) => { checkId(part?.id); saveTransfer.append(part); return true; },
      save: async (payload) => {
        checkId(payload?.id);
        if (typeof payload.saveAs !== "boolean") throw new Error("Invalid save request.");
        const draft = saveTransfer.take(payload.transferId);
        let target: string | undefined;
        if (payload.saveAs || !document.path) {
          if (dialogOpen) throw new Error("A file dialog is already open.");
          dialogOpen = true;
          try { target = (await chooseSavePath(document.snapshot())) ?? undefined; }
          finally { dialogOpen = false; }
          if (!target) return null;
        }
        checkId(payload.id);
        const saved = document.save(draft, target);
        dirty = false; updateTitle(); return documentMetadata(saved);
      },
      check: ({ id }) => {
        checkId(id);
        try { return { changed: document.changed(), error: null }; }
        catch (error) { return { changed: true, error: (error as Error).message }; }
      },
      reload: ({ id }) => { checkId(id); const result = document.reload(); saveTransfer.clear(); dirty = false; updateTitle(); return result; },
      confirmDiscard: async () => {
        const { response } = await Utils.showMessageBox({ type: "question", title: "Unsaved changes", message: `Save changes to ${document.snapshot().name}?`, detail: "Your text and comments have not been saved.", buttons: ["Save", "Cancel", "Discard Changes"], defaultId: 0, cancelId: 1 });
        return response === 0 ? "save" : response === 2 ? "discard" : "cancel";
      },
      openLink: ({ url }) => {
        if (typeof url !== "string" || url.length > 8192) throw new Error("Invalid link.");
        const parsed = new URL(url);
        if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) throw new Error("Only web and email links can be opened from the preview.");
        return Utils.openExternal(parsed.href);
      },
      windowAction: ({ action }): boolean => {
        if (action === "titlebar-double-click") {
          if (process.platform !== "darwin") throw new Error("Unknown window action.");
          if (macDoubleClick === "None" || appWindow.isFullScreen()) return true;
          return handleWindowAction(appWindow, macDoubleClick === "Minimize" ? "minimize" : "toggle-maximize");
        }
        return handleWindowAction(appWindow, action, windowsChrome);
      },
      finishClose: ({ quit }) => { approvedClose = true; if (quit) Utils.quit(); else appWindow.close(); return true; },
    },
    messages: {
      cancelSave: ({ transferId }) => { if (typeof transferId === "string") saveTransfer.clear(transferId); },
      dirty: (payload) => { if (payload?.id === document.id && typeof payload.dirty === "boolean") { dirty = payload.dirty; updateTitle(); } },
      ready: ({ userAgent }) => {
        diagnostic("sideleaf-ready", userAgent);
        diagnostic("windows-identity", String(configureWindowsIdentity()));
        if (!updateChecksStarted) {
          updateChecksStarted = true;
          setTimeout(() => { void updates.check(); }, 15_000);
          setInterval(() => { void updates.check(); }, 60 * 60 * 1000);
        }
      },
      diagnostic: (payload) => { if (typeof payload?.event === "string" && typeof payload.message === "string") diagnostic(payload.event.slice(0, 40), payload.message); },
    },
  },
});

const updates = new UpdateChecker({ installedVersion: APP_VERSION, cachePath: join(Utils.paths.userData, "updates.json"), onChange: (state) => rpc.send.update(state) });

appWindow = new BrowserWindow({
  title: "Untitled.md — Sideleaf",
  url: "views://main/index.html",
  renderer: "native",
  titleBarStyle: process.platform === "darwin" || process.platform === "win32" ? "hiddenInset" : "default",
  frame: { width: 1180, height: 780 },
  spellCheck: true,
  navigationRules: JSON.stringify(["^*", "views://main/*"]),
  rpc,
});
windowsChrome = configureWindowsChrome?.(appWindow);

function updateTitle() { appWindow.setTitle(`${dirty ? "● " : ""}${document.snapshot().name} — Sideleaf`); }
updateTitle();
let cliInstallationOpen = false;
async function installCLI(wsl = false): Promise<boolean> {
  if (cliInstallationOpen) return false;
  cliInstallationOpen = true;
  try {
    const distro = wsl ? await defaultWSLDistro() : null;
    if (wsl && !distro) throw new Error("WSL has no available default distribution.");
    const { response } = await Utils.showMessageBox({ type: "question", title: "Install Command Line Tool", message: wsl ? `Install sideleaf in ${distro}?` : "Install the sideleaf command?", detail: wsl ? "This installs into your default WSL distribution only and uses the Windows app's bundled runtime." : "Use sideleaf from a terminal to read and edit Markdown and comments. No Node or Bun installation is needed.", buttons: ["Install", "Cancel"], defaultId: 0, cancelId: 1 });
    if (response !== 0) return false;
    const detail = wsl ? await installWSLCommand(distro!) : await installCommandLineTool();
    await Utils.showMessageBox({ type: "info", title: "Command Line Tool Installed", message: "sideleaf is ready", detail, buttons: ["OK"] });
    return true;
  } catch (error) {
    await Utils.showMessageBox({ type: "error", title: "Command Installation", message: "Could not install the command", detail: (error as Error).message, buttons: ["OK"] });
    return false;
  } finally { cliInstallationOpen = false; }
}
function command(action: Command) { rpc.send.command(action); }
appWindow.on("will-close", (value) => {
  const event = value as { response: { allow: boolean } };
  if (!approvedClose) { event.response = { allow: false }; command("close"); }
});
events.on("before-quit", (value: unknown) => {
  const event = value as { response: { allow: boolean } };
  if (!approvedClose) { event.response = { allow: false }; command("quit"); }
});

if (process.platform !== "win32") ApplicationMenu.setApplicationMenu([
  { label: "Sideleaf", submenu: [{ label: "About Sideleaf", action: "about" }, { label: "Make Default Editor…", action: "makeDefaultEditor" }, { type: "divider" }, { label: "Install Command Line Tool…", action: "installCLI" }, { type: "divider" }, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "divider" }, { label: "Quit Sideleaf", action: "quit", accelerator: "CmdOrCtrl+Q" }] },
  { label: "File", submenu: [{ label: "New", action: "new", accelerator: "CmdOrCtrl+N" }, { label: "Open…", action: "open", accelerator: "CmdOrCtrl+O" }, { type: "divider" }, { label: "Save", action: "save", accelerator: "CmdOrCtrl+S" }, { label: "Save As…", action: "saveAs", accelerator: "CmdOrCtrl+Shift+S" }, { type: "divider" }, { label: "Close", action: "close", accelerator: "CmdOrCtrl+W" }] },
  { label: "Edit", submenu: [{ label: "Undo", action: "undo", accelerator: "CmdOrCtrl+Z" }, { label: "Redo", action: "redo", accelerator: "CmdOrCtrl+Shift+Z" }, { type: "divider" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "divider" }, { label: "Find…", action: "find", accelerator: "CmdOrCtrl+F" }, { label: "Add Comment", action: "comment", accelerator: "CmdOrCtrl+Shift+M" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
  { label: "Help", submenu: [{ label: "Check for Updates…", action: "checkUpdates" }, { label: "Sideleaf Website", action: "website" }] },
]);
const commands = new Set<Command>(["new", "open", "save", "saveAs", "close", "quit", "comment", "find", "undo", "redo", "about", "makeDefaultEditor"]);
ApplicationMenu.on("application-menu-clicked", (event) => {
  const action = (event as { data: { action: Command } }).data.action;
  if (String(action) === "installCLI") { void installCLI(); return; }
  if (String(action) === "checkUpdates") { void updates.check(true); return; }
  if (String(action) === "website") { Utils.openExternal("https://sideleaf.xyz/"); return; }
  if (commands.has(action)) command(action);
});
