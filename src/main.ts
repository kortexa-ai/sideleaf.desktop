import { pathFromLaunch, setFileActivationReceiver, takeInitialFileActivation } from "./platform/file-open.ts";
import events from "electrobun/main/events";
import { BrowserWindow } from "electrobun/main/browser-window";
import { BrowserView } from "electrobun/main/browser-view";
import * as ApplicationMenu from "electrobun/main/app-menu";
import * as Utils from "electrobun/main/utils";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DocumentFile } from "./document/files.ts";
import { ScratchStore } from "./document/scratch.ts";
import { SaveTransfer } from "./document/save-transfer.ts";
import { defaultWSLDistro, installCommandLineTool, installWSLCommand } from "./platform/cli-install.ts";
import { chooseSavePath } from "./platform/dialogs.ts";
import { handleWindowAction } from "./platform/window-controls.ts";
import { loadWindowsChrome, type WindowsChrome } from "./platform/windows-chrome.ts";
import { documentMetadata, type Command, type DocumentSnapshot, type SideleafRPC } from "./shared/contracts.ts";
import { APP_VERSION } from "./shared/version.ts";
import { customShortcutAccelerator, saveAsAccelerator } from "./ui/shortcuts.ts";
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
const launchPath = pathFromLaunch(process.argv, process.env.SIDELEAF_OPEN_PATH) ?? takeInitialFileActivation();
let hasInitialPath = launchPath !== null;
let document = launchPath ? DocumentFile.open(launchPath) : new DocumentFile();
const saveTransfer = new SaveTransfer();
const scratch = new ScratchStore(join(Utils.paths.userData, "untitled-draft.json"));
let initialDelivered = false;
let recoveredScratch = false;
let recoveryError: string | null = null;
let pendingOpenPath: string | null = null;
let rendererReady = false;
let dirty = false;
let approvedClose = false;
let dialogOpen = false;
let updateChecksStarted = false;
let appWindow: BrowserWindow;

function adoptDocument(next: DocumentFile): DocumentSnapshot {
  document = next; saveTransfer.clear(); scratch.clear(); recoveredScratch = false; dirty = false; updateTitle();
  return document.snapshot();
}

// When the app is already open, let the renderer run the same dirty-document
// flow as File → Open before the host consumes the pending path.
setFileActivationReceiver((path) => {
  if (!initialDelivered) {
    try { document = DocumentFile.open(path); hasInitialPath = true; }
    catch (error) { recoveryError = `Sideleaf could not open the selected Markdown file: ${(error as Error).message}`; diagnostic("file-activation-failed", (error as Error).message); }
    return;
  }
  pendingOpenPath = path;
  if (rendererReady) rpc.send.command("openExternal");
});

function checkId(id: string) {
  if (typeof id !== "string" || id !== document.id) throw new Error("This request belongs to an earlier document. Please try again.");
}

const rpc = BrowserView.defineRPC<SideleafRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      initial: ({ restoreScratch }) => {
        if (typeof restoreScratch !== "boolean") throw new Error("Invalid recovery preference.");
        diagnostic("initial-document", "Requested");
        if (!initialDelivered && !hasInitialPath && restoreScratch) {
          try {
            const draft = scratch.load();
            if (draft) { document = DocumentFile.fromDraft(draft); recoveredScratch = true; }
          } catch (error) {
            recoveryError = "Sideleaf could not restore its untitled draft. The recovery record was left untouched.";
            diagnostic("scratch-restore-failed", (error as Error).message);
          }
        }
        initialDelivered = true;
        return { document: document.snapshot(), recoveredScratch, recoveryError };
      },
      cliAvailability: async () => ({ wslDistro: await defaultWSLDistro() }),
      installCLI: ({ wsl }) => installCLI(wsl === true),
      updateState: () => updates.snapshot(),
      checkUpdates: () => updates.check(true),
      dismissUpdate: () => updates.dismiss(),
      openDefaultApps: () => {
        if (process.platform !== "win32") throw new Error("Default Apps is available on Windows only.");
        return Utils.openExternal("ms-settings:defaultapps?registeredAppUser=Sideleaf");
      },
      open: async () => {
        const paths = await Utils.openFileDialog({ allowedFileTypes: "md,markdown,mdown,txt", canChooseDirectory: false, allowsMultipleSelection: false });
        if (!paths[0]) return null;
        return adoptDocument(DocumentFile.open(paths[0]));
      },
      openPending: () => {
        if (!pendingOpenPath) return null;
        const path = pendingOpenPath; pendingOpenPath = null;
        return adoptDocument(DocumentFile.open(path));
      },
      cancelPendingOpen: () => { pendingOpenPath = null; return true; },
      newDocument: () => { document = new DocumentFile(); saveTransfer.clear(); scratch.clear(); recoveredScratch = false; dirty = false; updateTitle(); return document.snapshot(); },
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
        scratch.clear(); recoveredScratch = false; dirty = false; updateTitle(); return documentMetadata(saved);
      },
      saveScratch: ({ id, transferId }) => {
        checkId(id);
        if (document.path) throw new Error("Only an untitled document can use draft recovery.");
        scratch.save(saveTransfer.take(transferId));
        return true;
      },
      clearScratch: () => { scratch.clear(); recoveredScratch = false; return true; },
      check: ({ id }) => {
        checkId(id);
        // The stat fingerprint is lstat-only; the full read + hash runs only
        // when mtime, size, mode, or the sidecar actually changed.
        if (document.statUnchanged()) return { changed: false, error: null };
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
        rendererReady = true;
        diagnostic("sideleaf-ready", userAgent);
        diagnostic("windows-identity", String(configureWindowsIdentity()));
        if (pendingOpenPath) rpc.send.command("openExternal");
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
  if (!approvedClose) { event.response = { allow: false }; command("quit"); }
});
events.on("before-quit", (value: unknown) => {
  const event = value as { response: { allow: boolean } };
  if (!approvedClose) { event.response = { allow: false }; command("quit"); }
});

const saveAsMenuAccelerator = saveAsAccelerator(process.platform);
if (process.platform !== "win32") ApplicationMenu.setApplicationMenu([
  { label: "Sideleaf", submenu: [{ label: "About Sideleaf", action: "about" }, { label: "Settings…", action: "settings", accelerator: "CmdOrCtrl+," }, { type: "divider" }, { label: "Make Default Editor…", action: "makeDefaultEditor" }, { type: "divider" }, { label: "Install Command Line Tool…", action: "installCLI" }, { type: "divider" }, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "divider" }, { label: "Quit Sideleaf", action: "quit", accelerator: "CmdOrCtrl+Q" }] },
  { label: "File", submenu: [{ label: "New", action: "new", accelerator: "CmdOrCtrl+N" }, { label: "Open…", action: "open", accelerator: "CmdOrCtrl+O" }, { type: "divider" }, { label: "Save", action: "save", accelerator: "CmdOrCtrl+S" }, { label: "Save As…", action: "saveAs", ...(saveAsMenuAccelerator ? { accelerator: saveAsMenuAccelerator } : {}) }, { type: "divider" }, { label: "Close", action: "close", accelerator: "CmdOrCtrl+W" }] },
  { label: "Edit", submenu: [{ label: "Undo", action: "undo", accelerator: "CmdOrCtrl+Z" }, { label: "Redo", action: "redo", accelerator: "CmdOrCtrl+Shift+Z" }, { type: "divider" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "divider" }, { label: "Find…", action: "find", accelerator: "CmdOrCtrl+F" }, { label: "Add Comment", action: "comment", accelerator: customShortcutAccelerator(process.platform, "C") }] },
  { label: "View", submenu: [{ label: "Write", action: "modeWrite", accelerator: customShortcutAccelerator(process.platform, "W") }, { label: "Split", action: "modeSplit", accelerator: customShortcutAccelerator(process.platform, "S") }, { label: "Read", action: "modeRead", accelerator: customShortcutAccelerator(process.platform, "R") }, { type: "divider" }, { label: "Distraction-Free Mode", action: "distractionFree", accelerator: customShortcutAccelerator(process.platform, "D") }, { type: "divider" }, { label: "Zoom In", action: "zoomIn", accelerator: "CmdOrCtrl+Shift+=" }, { label: "Zoom Out", action: "zoomOut", accelerator: "CmdOrCtrl+-" }, { label: "Actual Size", action: "zoomReset", accelerator: "CmdOrCtrl+0" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
  { label: "Help", submenu: [{ label: "Check for Updates…", action: "checkUpdates" }, { label: "Sideleaf Website", action: "website" }] },
]);
const commands = new Set<Command>(["new", "open", "save", "saveAs", "close", "quit", "comment", "find", "undo", "redo", "modeWrite", "modeSplit", "modeRead", "distractionFree", "zoomIn", "zoomOut", "zoomReset", "about", "settings", "makeDefaultEditor"]);
ApplicationMenu.on("application-menu-clicked", (event) => {
  const action = (event as { data: { action: Command } }).data.action;
  if (String(action) === "installCLI") { void installCLI(); return; }
  if (String(action) === "checkUpdates") { void updates.check(true); return; }
  if (String(action) === "website") { Utils.openExternal("https://sideleaf.xyz/"); return; }
  if (commands.has(action)) command(action);
});
