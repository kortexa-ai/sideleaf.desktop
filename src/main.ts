import { BrowserWindow } from "electrobun/main/browser-window";
import { BrowserView } from "electrobun/main/browser-view";
import * as ApplicationMenu from "electrobun/main/app-menu";
import * as Utils from "electrobun/main/utils";
import events from "electrobun/main/events";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DocumentFile } from "./document/files.ts";
import { chooseSavePath } from "./platform/dialogs.ts";
import { documentMetadata, validateDraft, type Command, type SideleafRPC } from "./shared/contracts.ts";

const launchTime = performance.now();
const startupLog = join(Utils.paths.userLogs, "startup.jsonl");
try { mkdirSync(Utils.paths.userLogs, { recursive: true }); writeFileSync(startupLog, "", { mode: 0o600 }); } catch { /* Diagnostics must not prevent startup. */ }
function diagnostic(event: string, message: string) {
  const record = { event, message: message.slice(0, 1000), millisecondsFromHost: Math.round(performance.now() - launchTime), platform: process.platform };
  console.info(JSON.stringify(record));
  try { appendFileSync(startupLog, `${JSON.stringify(record)}\n`); } catch { /* Keep the app usable if its log directory is read-only. */ }
}
diagnostic("host-started", "Sideleaf 0.1.0");
let document = new DocumentFile();
let dirty = false;
let approvedClose = false;
let dialogOpen = false;

function checkId(id: string) {
  if (typeof id !== "string" || id !== document.id) throw new Error("This request belongs to an earlier document. Please try again.");
}

const rpc = BrowserView.defineRPC<SideleafRPC>({
  maxRequestTime: 120_000,
  handlers: {
    requests: {
      initial: () => { diagnostic("initial-document", "Requested"); return document.snapshot(); },
      open: async () => {
        const paths = await Utils.openFileDialog({ allowedFileTypes: "md,markdown,mdown,txt", canChooseDirectory: false, allowsMultipleSelection: false });
        if (!paths[0]) return null;
        const next = DocumentFile.open(paths[0]);
        document = next; dirty = false; updateTitle();
        return document.snapshot();
      },
      newDocument: () => { document = new DocumentFile(); dirty = false; updateTitle(); return document.snapshot(); },
      save: async (payload) => {
        checkId(payload?.id); validateDraft(payload.draft);
        if (typeof payload.saveAs !== "boolean") throw new Error("Invalid save request.");
        let target: string | undefined;
        if (payload.saveAs || !document.path) {
          if (dialogOpen) throw new Error("A file dialog is already open.");
          dialogOpen = true;
          try { target = (await chooseSavePath(document.snapshot())) ?? undefined; }
          finally { dialogOpen = false; }
          if (!target) return null;
        }
        checkId(payload.id);
        const saved = document.save(payload.draft, target);
        dirty = false; updateTitle(); return documentMetadata(saved);
      },
      check: ({ id }) => {
        checkId(id);
        try { return { changed: document.changed(), error: null }; }
        catch (error) { return { changed: true, error: (error as Error).message }; }
      },
      reload: ({ id }) => { checkId(id); const result = document.reload(); dirty = false; updateTitle(); return result; },
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
      finishClose: ({ quit }) => { approvedClose = true; if (quit) Utils.quit(); else window.close(); return true; },
    },
    messages: {
      dirty: (payload) => { if (payload?.id === document.id && typeof payload.dirty === "boolean") { dirty = payload.dirty; updateTitle(); } },
      ready: ({ userAgent }) => diagnostic("sideleaf-ready", userAgent),
      diagnostic: (payload) => { if (typeof payload?.event === "string" && typeof payload.message === "string") diagnostic(payload.event.slice(0, 40), payload.message); },
    },
  },
});

const window = new BrowserWindow({
  title: "Untitled.md — Sideleaf",
  url: "views://main/index.html",
  renderer: "native",
  frame: { width: 1180, height: 780 },
  spellCheck: true,
  navigationRules: JSON.stringify(["^*", "views://main/*"]),
  rpc,
});

function updateTitle() { window.setTitle(`${dirty ? "● " : ""}${document.snapshot().name} — Sideleaf`); }
function command(action: Command) { rpc.send.command(action); }
window.on("will-close", (value) => {
  const event = value as { response: { allow: boolean } };
  if (!approvedClose) { event.response = { allow: false }; command("close"); }
});
events.on("before-quit", (value: unknown) => {
  const event = value as { response: { allow: boolean } };
  if (!approvedClose) { event.response = { allow: false }; command("quit"); }
});

ApplicationMenu.setApplicationMenu([
  { label: "Sideleaf", submenu: [{ role: "about" }, { type: "divider" }, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "divider" }, { label: "Quit Sideleaf", action: "quit", accelerator: "CmdOrCtrl+Q" }] },
  { label: "File", submenu: [{ label: "New", action: "new", accelerator: "CmdOrCtrl+N" }, { label: "Open…", action: "open", accelerator: "CmdOrCtrl+O" }, { type: "divider" }, { label: "Save", action: "save", accelerator: "CmdOrCtrl+S" }, { label: "Save As…", action: "saveAs", accelerator: "CmdOrCtrl+Shift+S" }, { type: "divider" }, { label: "Close", action: "close", accelerator: "CmdOrCtrl+W" }] },
  { label: "Edit", submenu: [{ label: "Undo", action: "undo", accelerator: "CmdOrCtrl+Z" }, { label: "Redo", action: "redo", accelerator: "CmdOrCtrl+Shift+Z" }, { type: "divider" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, { type: "divider" }, { label: "Find…", action: "find", accelerator: "CmdOrCtrl+F" }, { label: "Add Comment", action: "comment", accelerator: "CmdOrCtrl+Shift+M" }] },
  { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "toggleFullScreen" }] },
]);
const commands = new Set<Command>(["new", "open", "save", "saveAs", "close", "quit", "comment", "find", "undo", "redo"]);
ApplicationMenu.on("application-menu-clicked", (event) => {
  const action = (event as { data: { action: Command } }).data.action;
  if (commands.has(action)) command(action);
});
