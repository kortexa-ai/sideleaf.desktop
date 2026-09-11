import { pathFromLaunch, setFileActivationReceiver, takeInitialFileActivation } from "./platform/file-open.ts";
import events from "electrobun/main/events";
import { BrowserWindow } from "electrobun/main/browser-window";
import { BrowserView } from "electrobun/main/browser-view";
import * as ApplicationMenu from "electrobun/main/app-menu";
import * as Utils from "electrobun/main/utils";
import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DocumentFile } from "./document/files.ts";
import { RecoveryStore, ScratchStore } from "./document/scratch.ts";
import { DocumentWorkspace } from "./document/workspace.ts";
import { defaultWSLDistro, installCommandLineTool, installWSLCommand } from "./platform/cli-install.ts";
import { chooseSavePath } from "./platform/dialogs.ts";
import { handleWindowAction } from "./platform/window-controls.ts";
import { loadWindowsChrome, type WindowsChrome } from "./platform/windows-chrome.ts";
import { documentMetadata, type Command, type RecoveredDocument, type SideleafRPC } from "./shared/contracts.ts";
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
const workspace = new DocumentWorkspace((workspaceId) => { if (rendererReady) rpc.send.foldersChanged({ workspaceId }); });
if (launchPath) workspace.open(launchPath); else workspace.newDocument();
const scratch = new ScratchStore(join(Utils.paths.userData, "untitled-draft.json"));
const recovery = new RecoveryStore(join(Utils.paths.userData, "document-recovery"));
let initialDelivered = false;
let recoveredScratch = false;
let recoveryError: string | null = null;
let pendingOpenPath: string | null = null;
let rendererReady = false;
let approvedClose = false;
let dialogOpen = false;
let updateChecksStarted = false;
let appWindow: BrowserWindow;

function clearClosedRecovery(previous: string[]) {
  for (const id of previous) if (!workspace.sessions.has(id)) recovery.clear(id);
}
function mutateWorkspace<T>(operation: () => T): T {
  const previous = [...workspace.sessions.keys()];
  const result = operation(); clearClosedRecovery(previous); updateTitle(); return result;
}

// When the app is already open, let the renderer run the same dirty-document
// flow as File → Open before the host consumes the pending path.
setFileActivationReceiver((path) => {
  if (!initialDelivered) {
    try { workspace.open(path); hasInitialPath = true; }
    catch (error) { recoveryError = `Sideleaf could not open the selected Markdown file: ${(error as Error).message}`; diagnostic("file-activation-failed", (error as Error).message); }
    return;
  }
  pendingOpenPath = path;
  if (rendererReady) rpc.send.command("openExternal");
});

const rpc = BrowserView.defineRPC<SideleafRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      initial: ({ restoreScratch }) => {
        if (typeof restoreScratch !== "boolean") throw new Error("Invalid recovery preference.");
        diagnostic("initial-document", "Requested");
        const recovered: RecoveredDocument[] = [];
        if (!initialDelivered && restoreScratch) {
          try {
            const loaded = recovery.load();
            const launchedId = hasInitialPath ? workspace.activeId : null;
            if (loaded.records.length && !hasInitialPath) workspace.reset();
            if (loaded.errors.length) recoveryError = loaded.errors.join(" ");
            for (const record of loaded.records) {
              // Restored text is an untitled copy: it can never autosave over
              // a newer original. Retain the source path/revision for context.
              const file = DocumentFile.fromDraft(record.draft);
              workspace.add(file).recoveredFrom = { path: record.originalPath, revision: record.revision };
              recovered.push({ document: file.snapshot(), originalPath: record.originalPath, revision: record.revision, pending: record.pending });
              recovery.save({ ...record, id: file.id });
              recovery.clear(record.id);
            }
            if (launchedId) workspace.activate(launchedId);
            if (workspace.sessions.size > 1) workspace.explicit = true;
            const draft = scratch.load();
            if (draft) {
              if (!hasInitialPath && !recovered.length) workspace.reset();
              const file = DocumentFile.fromDraft(draft); workspace.add(file);
              recovery.save({ id: file.id, originalPath: null, revision: null, draft });
              scratch.clear(); recoveredScratch = true;
              recovered.push({ document: file.snapshot(), originalPath: null, revision: null });
            }
          } catch (error) {
            recoveryError = "Some draft recovery records could not be restored. They were left untouched.";
            diagnostic("scratch-restore-failed", (error as Error).message);
          }
        }
        initialDelivered = true;
        return { ...workspace.result(), recovered, recoveredScratch, recoveryError };
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
        return mutateWorkspace(() => workspace.open(paths[0]!));
      },
      openFolder: async () => {
        const paths = await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false });
        if (!paths[0]) return null;
        return mutateWorkspace(() => workspace.openFolder(paths[0]!));
      },
      closeFolder: () => mutateWorkspace(() => { workspace.reset(); return workspace.newDocument(); }),
      workspace: () => workspace.info(),
      listFolder: ({ workspaceId, key }) => workspace.folder(workspaceId).list(key),
      watchFolders: ({ workspaceId, keys }) => { workspace.folder(workspaceId).watch(keys); return true; },
      openEntry: ({ workspaceId, key }) => { const result = workspace.openEntry(workspaceId, key); updateTitle(); return result; },
      activateDocument: ({ id }) => { const info = workspace.activate(id); updateTitle(); return info; },
      closeDocument: ({ id }) => mutateWorkspace(() => workspace.closeDocument(id)),
      renameDocument: ({ id, name }) => {
        const session = workspace.get(id);
        const snapshot = session.file.rename(name);
        workspace.refreshRootAfterSave(id); updateTitle(); return documentMetadata(snapshot);
      },
      trashDocument: async ({ id }) => {
        const session = workspace.get(id), file = session.file;
        if (!file.path) throw new Error("This document has no file to move to Trash.");
        if (file.path.startsWith("\\\\")) throw new Error("Recycle Bin is unavailable for this network or WSL folder. Use its file manager to remove the file.");
        if (existsSync(`${file.path}.sideleaf.json`)) throw new Error("Save this document once to move its legacy comments into the file before moving it to Trash.");
        if (file.changed()) throw new Error("The file changed on disk. Reload it before moving it to Trash.");
        const { response } = await Utils.showMessageBox({ type: "question", title: "Move to Trash", message: `Move ${file.name} to ${process.platform === "win32" ? "the Recycle Bin" : "Trash"}?`, detail: "The file will be removed from this folder.", buttons: ["Move to Trash", "Cancel"], defaultId: 1, cancelId: 1 });
        if (response !== 0) return workspace.result();
        if (workspace.get(id) !== session || file.changed()) throw new Error("The file changed before it could be moved. Your document is still open.");
        if (!Utils.moveToTrash(file.path)) throw new Error("The system could not move this file to Trash. Your document is still open.");
        const result = mutateWorkspace(() => workspace.closeDocument(id)); workspace.root?.notify(); return result;
      },
      openPending: () => {
        if (!pendingOpenPath) return null;
        const path = pendingOpenPath; pendingOpenPath = null;
        return mutateWorkspace(() => workspace.open(path));
      },
      cancelPendingOpen: () => { pendingOpenPath = null; return true; },
      newDocument: () => mutateWorkspace(() => workspace.newDocument()),
      stageSave: (part) => { workspace.get(part?.id).transfer.append(part); return true; },
      save: async (payload) => {
        const session = workspace.get(payload?.id), file = session.file;
        if (typeof payload.saveAs !== "boolean") throw new Error("Invalid save request.");
        const draft = session.transfer.take(payload.transferId);
        let target: string | undefined;
        if (payload.saveAs || !file.path) {
          if (dialogOpen) throw new Error("A file dialog is already open.");
          const folder = workspace.root?.resolve(payload.folderKey ?? "", "directory");
          dialogOpen = true;
          try { target = (await chooseSavePath(file, folder)) ?? undefined; }
          finally { dialogOpen = false; }
          if (!target) return null;
        }
        if (workspace.get(payload.id) !== session) throw new Error("This document was closed during the save dialog.");
        if (target) workspace.assertSaveTarget(payload.id, target);
        const saved = file.save(draft, target);
        recovery.clear(file.id); session.dirty = false; workspace.refreshRootAfterSave(file.id); updateTitle();
        return documentMetadata(saved);
      },
      saveScratch: ({ id, transferId, pending }) => {
        const session = workspace.get(id);
        recovery.save({ id, originalPath: session.file.path ?? session.recoveredFrom?.path ?? null, revision: session.file.path ? session.file.revision() : session.recoveredFrom?.revision ?? null, draft: session.transfer.take(transferId), pending });
        return true;
      },
      clearScratch: ({ id }) => { if (id) recovery.clear(id); else { recovery.clearAll(); scratch.clear(); } return true; },
      check: ({ id }) => {
        const file = workspace.get(id).file;
        // Known clean/conflicting stats reuse #46's cached comparison.
        try { return { changed: file.pollChanged(), error: null }; }
        catch (error) { return { changed: true, error: (error as Error).message }; }
      },
      reload: ({ id }) => {
        const session = workspace.get(id), result = session.file.reload();
        session.transfer.clear(); session.dirty = false; recovery.clear(id); updateTitle(); return result;
      },
      confirmDiscard: async ({ id }) => {
        const file = workspace.get(id).file;
        const { response } = await Utils.showMessageBox({ type: "question", title: "Unsaved changes", message: `Save changes to ${file.name}?`, detail: "Your text and comments have not been saved.", buttons: ["Save", "Cancel", "Discard Changes"], defaultId: 0, cancelId: 1 });
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
      cancelSave: ({ transferId }) => { if (typeof transferId === "string") for (const session of workspace.sessions.values()) session.transfer.clear(transferId); },
      dirty: (payload) => { const session = workspace.sessions.get(payload?.id); if (session && typeof payload.dirty === "boolean") { session.dirty = payload.dirty; updateTitle(); } },
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

function updateTitle() { appWindow.setTitle(`${workspace.dirty ? "● " : ""}${workspace.activeId ? workspace.get(workspace.activeId).file.name : workspace.info().name} — Sideleaf`); }
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
  { label: "File", submenu: [{ label: "New", action: "new", accelerator: "CmdOrCtrl+N" }, { label: "Open…", action: "open", accelerator: "CmdOrCtrl+O" }, { label: "Open Folder…", action: "openFolder" }, { label: "Close Folder", action: "closeFolder" }, { type: "divider" }, { label: "Save", action: "save", accelerator: "CmdOrCtrl+S" }, { label: "Save As…", action: "saveAs", ...(saveAsMenuAccelerator ? { accelerator: saveAsMenuAccelerator } : {}) }, { type: "divider" }, { label: "Close", action: "close", accelerator: "CmdOrCtrl+W" }] },
  { label: "Edit", submenu: [{ label: "Undo", action: "undo", accelerator: "CmdOrCtrl+Z" }, { label: "Redo", action: "redo", accelerator: "CmdOrCtrl+Shift+Z" }, { type: "divider" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "divider" }, { label: "Find…", action: "find", accelerator: "CmdOrCtrl+F" }, { label: "Add Comment", action: "comment", accelerator: customShortcutAccelerator(process.platform, "C") }] },
  { label: "View", submenu: [{ label: "Show/Hide Folder", action: "toggleFolder", accelerator: customShortcutAccelerator(process.platform, "F") }, { type: "divider" }, { label: "Write", action: "modeWrite", accelerator: customShortcutAccelerator(process.platform, "W") }, { label: "Split", action: "modeSplit", accelerator: customShortcutAccelerator(process.platform, "S") }, { label: "Read", action: "modeRead", accelerator: customShortcutAccelerator(process.platform, "R") }, { type: "divider" }, { label: "Distraction-Free Mode", action: "distractionFree", accelerator: customShortcutAccelerator(process.platform, "D") }, { type: "divider" }, { label: "Zoom In", action: "zoomIn", accelerator: "CmdOrCtrl+Shift+=" }, { label: "Zoom Out", action: "zoomOut", accelerator: "CmdOrCtrl+-" }, { label: "Actual Size", action: "zoomReset", accelerator: "CmdOrCtrl+0" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
  { label: "Help", submenu: [{ label: "Check for Updates…", action: "checkUpdates" }, { label: "Sideleaf Website", action: "website" }] },
]);
const commands = new Set<Command>(["new", "open", "openFolder", "closeFolder", "toggleFolder", "save", "saveAs", "close", "quit", "comment", "find", "undo", "redo", "modeWrite", "modeSplit", "modeRead", "distractionFree", "zoomIn", "zoomOut", "zoomReset", "about", "settings", "makeDefaultEditor"]);
ApplicationMenu.on("application-menu-clicked", (event) => {
  const action = (event as { data: { action: Command } }).data.action;
  if (String(action) === "installCLI") { void installCLI(); return; }
  if (String(action) === "checkUpdates") { void updates.check(true); return; }
  if (String(action) === "website") { Utils.openExternal("https://sideleaf.xyz/"); return; }
  if (commands.has(action)) command(action);
});
