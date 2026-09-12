import { launchRequestFromLaunch, setFileActivationReceiver, takeInitialFileActivation } from "./platform/file-open.ts";
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
import { documentMetadata, validateDraft, type CollaborationTarget, type Command, type Draft, type LiveDocumentInfo, type RecoveredDocument, type SideleafRPC } from "./shared/contracts.ts";
import { APP_VERSION } from "./shared/version.ts";
import { customShortcutAccelerator, saveAsAccelerator } from "./ui/shortcuts.ts";
import { UpdateChecker } from "./updates.ts";
import { startAppChannel, type AppCommand, type AppRequest, type AppRequestContext, type CollaborationOperation } from "./collaboration/channel.ts";
import { COLLABORATION_CONTRACT, CollaborationError } from "./collaboration/operations.ts";

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
const activatedPath = takeInitialFileActivation();
const launchRequest = launchRequestFromLaunch(process.argv, process.env.SIDELEAF_OPEN_PATH, process.env.SIDELEAF_OPEN_KIND) ??
  (activatedPath ? { kind: "open" as const, path: activatedPath } : null);
let rendererReady = false;
const workspace = new DocumentWorkspace((workspaceId) => { if (rendererReady) rpc.send.foldersChanged({ workspaceId }); });
const earlyAppCommands: AppCommand[] = [];
let markAppReceiverReady!: () => void;
let appReceiverReadyFlag = false;
const appReceiverReady = new Promise<void>((accept) => { markAppReceiverReady = accept; });
let appCommandReceiver = (command: AppRequest, _context: AppRequestContext): unknown => {
  if (command.kind === "collaboration") throw new CollaborationError("Sideleaf is still starting. Retry shortly.", "BUSY", true);
  earlyAppCommands.push(command);
  return undefined;
};
const appChannel = await startAppChannel(Utils.paths.userData, async (command, context) => {
  if (command.kind === "collaboration" && !appReceiverReadyFlag) {
    if (command.operation.kind === "ownership") return { owned: !!ownedSession(command.operation.target) };
    await appReceiverReady;
  }
  return appCommandReceiver(command, context);
}, { secondaryCommand: launchRequest ?? { kind: "activate" } });
if (appChannel.kind === "delivered") process.exit(0);
if (appChannel.kind !== "primary") throw new Error("Sideleaf app channel did not start.");
const primaryChannel = appChannel;
const launchPath = launchRequest?.path ?? null;
let hasInitialPath = launchPath !== null;
if (launchPath) await workspace.openOwned(launchPath); else workspace.newDocument();
const scratch = new ScratchStore(join(Utils.paths.userData, "untitled-draft.json"));
const recovery = new RecoveryStore(join(Utils.paths.userData, "document-recovery"));
let initialDelivered = false;
let recoveredScratch = false;
let recoveryError: string | null = null;
const pendingOpenPaths: { path: string; kind: "open" | "open-folder" }[] = [];
const closingWaiters = new Set<(value: { outcome: "app-closed" }) => void>();
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
async function mutateWorkspaceAsync<T>(operation: () => Promise<T>): Promise<T> {
  const previous = [...workspace.sessions.keys()];
  const result = await operation(); clearClosedRecovery(previous); updateTitle(); return result;
}

// When the app is already open, let the renderer run the same dirty-document
// flow as File → Open before the host consumes the pending path.
async function receiveExternalOpen(path: string, kind: "open" | "open-folder" = "open") {
  if (!initialDelivered) {
    try { await workspace.openOwned(path); hasInitialPath = true; }
    catch (error) { recoveryError = `Sideleaf could not open the selected file: ${(error as Error).message}`; diagnostic("file-activation-failed", (error as Error).message); }
    return;
  }
  pendingOpenPaths.push({ path, kind });
  if (rendererReady) rpc.send.command("openExternal");
}
setFileActivationReceiver((path) => { void receiveExternalOpen(path); });

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
              const file = DocumentFile.fromDraft(record.draft, record.originalPath);
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
        return mutateWorkspaceAsync(() => workspace.openOwned(paths[0]!));
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
      openEntry: async ({ workspaceId, key }) => { const result = await workspace.openEntryOwned(workspaceId, key); updateTitle(); return result; },
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
        file.trash(Utils.moveToTrash);
        const result = mutateWorkspace(() => workspace.closeDocument(id)); workspace.root?.notify(); return result;
      },
      openPending: async () => {
        const pending = pendingOpenPaths.shift();
        if (!pending) return null;
        const result = await mutateWorkspaceAsync(() => workspace.openOwned(pending.path));
        if (pendingOpenPaths.length && rendererReady) queueMicrotask(() => rpc.send.command("openExternal"));
        return result;
      },
      pendingOpenRequiresLeave: () => pendingOpenPaths[0]?.kind === "open-folder" || (!!pendingOpenPaths[0] && !workspace.explicit),
      cancelPendingOpen: () => {
        pendingOpenPaths.shift();
        if (pendingOpenPaths.length && rendererReady) queueMicrotask(() => rpc.send.command("openExternal"));
        return true;
      },
      newDocument: () => mutateWorkspace(() => workspace.newDocument()),
      stageSave: (part) => { workspace.get(part?.id).transfer.append(part); return true; },
      save: async (payload) => {
        const session = workspace.get(payload?.id), file = session.file;
        if (typeof payload.saveAs !== "boolean") throw new Error("Invalid save request.");
        const draft = session.transfer.take(payload.transferId);
        let target: string | undefined;
        if (payload.saveAs || !file.path) {
          if (dialogOpen) throw new Error("A file dialog is already open.");
          let folder = workspace.root?.path;
          if (workspace.root) {
            try { folder = workspace.root.resolve(payload.folderKey ?? "", "directory"); }
            catch { folder = workspace.root.resolve("", "directory"); }
          }
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
      finishClose: async ({ quit }) => {
        approvedClose = true;
        for (const close of [...closingWaiters]) close({ outcome: "app-closed" });
        await primaryChannel.close();
        if (quit) Utils.quit(); else appWindow.close();
        return true;
      },
    },
    messages: {
      cancelSave: ({ transferId }) => { if (typeof transferId === "string") for (const session of workspace.sessions.values()) session.transfer.clear(transferId); },
      dirty: (payload) => { const session = workspace.sessions.get(payload?.id); if (session && typeof payload.dirty === "boolean") { session.dirty = payload.dirty; updateTitle(); } },
      ready: ({ userAgent }) => {
        rendererReady = true;
        diagnostic("sideleaf-ready", userAgent);
        diagnostic("windows-identity", String(configureWindowsIdentity()));
        // Reapply after the document is ready: the constructor flag alone can
        // leave native WKWebView spelling disabled during initial navigation.
        if (process.platform === "darwin") {
          try { diagnostic("mac-spellcheck", String(appWindow.setSpellCheck(true))); }
          catch (error) { diagnostic("mac-spellcheck", (error as Error).message); }
        }
        if (pendingOpenPaths.length) rpc.send.command("openExternal");
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

function ownedSession(target: CollaborationTarget) {
  const matches = [...workspace.sessions.values()].filter((session) => target.documentId ? session.file.id === target.documentId : session.file.path === target.path);
  return matches.length === 1 ? matches[0]! : null;
}

async function waitForRenderer(context: AppRequestContext) {
  while (!rendererReady) {
    if (approvedClose || context.signal.aborted || Date.now() >= context.deadline) throw new CollaborationError("Sideleaf is not ready to answer this request. Retry shortly.", "BUSY", true);
    await new Promise((accept) => setTimeout(accept, 20));
  }
}

async function rendererDocuments(context: AppRequestContext): Promise<LiveDocumentInfo[]> {
  await waitForRenderer(context);
  return rpc.request.collaborationDocuments({ instanceId: primaryChannel.instanceId });
}

async function readLive(target: CollaborationTarget, context: AppRequestContext) {
  const session = ownedSession(target);
  if (!session) return { owned: false as const };
  await waitForRenderer(context);
  const start = await rpc.request.collaborationReadStart({ instanceId: primaryChannel.instanceId, target });
  if (start.total < 1 || start.total > 256 || start.document.id !== session.file.id) throw new CollaborationError("The live snapshot transfer was inconsistent. Reread the document.", "UNCERTAIN", true);
  let serialized = "";
  for (let index = 0; index < start.total; index++) {
    if (context.signal.aborted || Date.now() >= context.deadline) throw new CollaborationError("The live snapshot request expired. Reread the document.", "UNCERTAIN", true);
    serialized += await rpc.request.collaborationReadChunk({ transferId: start.transferId, index });
  }
  let draft: Draft;
  try { draft = JSON.parse(serialized); validateDraft(draft); }
  catch { throw new CollaborationError("Sideleaf returned an invalid live snapshot.", "UNCERTAIN", true); }
  if (ownedSession({ documentId: start.document.id }) !== session) throw new CollaborationError("The document changed ownership during the live read. Reread it.", "UNCERTAIN", true);
  return { owned: true as const, contract: COLLABORATION_CONTRACT, live: true as const, saved: !start.document.dirty,
    dirty: start.document.dirty, active: start.document.active, documentId: start.document.id, path: start.document.path,
    name: start.document.name, lineEnding: start.document.lineEnding, notice: start.document.notice, revision: start.document.revision,
    savedRevision: session.file.path ? session.file.revision() : null, text: draft.text, comments: draft.comments };
}

async function handleCollaboration(operation: CollaborationOperation, context: AppRequestContext): Promise<unknown> {
  if (approvedClose) throw new CollaborationError("Sideleaf is closing. Reconcile the request after it exits.", "UNCERTAIN", true);
  if (operation.kind === "ownership") return { owned: !!ownedSession(operation.target) };
  if (operation.kind === "documents") {
    const documents = await rendererDocuments(context);
    return { contract: COLLABORATION_CONTRACT, documents: documents.map((document) => ({ ...document,
      savedRevision: document.path ? workspace.get(document.id).file.revision() : null })) };
  }
  if (operation.kind === "read") return readLive(operation.target, context);
  if (operation.kind === "apply") {
    const session = ownedSession(operation.target);
    if (!session) return { owned: false };
    await waitForRenderer(context);
    if (context.signal.aborted || Date.now() > operation.deadline) throw new CollaborationError("The apply request expired before dispatch. Reread before retrying.", "UNCERTAIN", true);
    const response = await rpc.request.collaborationApply({ instanceId: primaryChannel.instanceId, target: operation.target, actor: operation.actor,
      ifRevision: operation.ifRevision, envelope: operation.envelope, deadline: operation.deadline });
    if (!response.ok) throw new CollaborationError(response.error, response.code, response.retryable);
    const result = response.result;
    if (ownedSession({ documentId: result.document.id }) !== session) throw new CollaborationError("The document changed ownership during apply. Reconcile by reading it again.", "UNCERTAIN", true);
    return { owned: true, ok: true, contract: COLLABORATION_CONTRACT, live: true, saved: !result.document.dirty, dirty: result.document.dirty,
      autoSave: result.autoSave, documentId: result.document.id, path: result.document.path, revision: result.document.revision,
      savedRevision: session.file.path ? session.file.revision() : null, change: result.change };
  }
  if (operation.kind !== "wait") throw new CollaborationError("Unsupported collaboration operation.", "INVALID");
  const session = ownedSession(operation.target);
  if (!session) return { owned: false };
  const documents = await rendererDocuments(context);
  const document = documents.find((candidate) => candidate.id === session.file.id);
  if (!document) throw new CollaborationError("The owned document is not ready in the editor.", "BUSY", true);
  if (document.revision !== operation.after) return { owned: true, contract: COLLABORATION_CONTRACT, outcome: "resync", revision: document.revision };
  return new Promise((accept, reject) => {
    let settled = false;
    const finish = (value: { outcome: "app-closed" } | { outcome: "timeout" }) => {
      if (settled) return; settled = true; clearTimeout(timer); closingWaiters.delete(close); context.signal.removeEventListener("abort", abort);
      accept({ owned: true, contract: COLLABORATION_CONTRACT, ...value });
    };
    const close = (value: { outcome: "app-closed" }) => finish(value);
    const abort = () => { if (!settled) { settled = true; clearTimeout(timer); closingWaiters.delete(close); reject(new CollaborationError("The wait was cancelled.", "UNCERTAIN", true)); } };
    const timer = setTimeout(() => finish({ outcome: "timeout" }), operation.timeoutMs);
    closingWaiters.add(close); context.signal.addEventListener("abort", abort, { once: true });
  });
}

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
appCommandReceiver = async (command, context) => {
  if (command.kind === "collaboration") return handleCollaboration(command.operation, context);
  if (appWindow.isMinimized()) appWindow.unminimize();
  appWindow.show();
  if (command.kind !== "activate") await receiveExternalOpen(command.path, command.kind);
};
appReceiverReadyFlag = true; markAppReceiverReady();
for (const command of earlyAppCommands.splice(0)) void appCommandReceiver(command, { requestId: "startup", deadline: Date.now() + 4_000, signal: new AbortController().signal });

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
