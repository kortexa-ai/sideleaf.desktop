import "./bootstrap.ts";
import { Electroview } from "electrobun/view";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, type StateEffect, type Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { redo, undo, isolateHistory } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { agentHighlightField, commentField, commentHistory, composeAgentChanges, setAgentHighlights, setComments } from "./comments.ts";
import { PREVIEW_LIMIT, renderMarkdown, setHardBreaks } from "./markdown.ts";
import { customShortcutAction, customShortcutLabel, layoutShortcutAction, layoutShortcutLabel } from "./shortcuts.ts";
import { resolveTheme, storedTheme, THEME_STORAGE_KEY, type ThemePreference } from "./theme.ts";
import { wordCountField } from "./word-count.ts";
import { changeZoom, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, normalizeZoom, storedZoom, zoomActionForCode, ZOOM_STEP } from "./zoom.ts";
import { commentRange, makeAnchor } from "../document/anchors.ts";
import { SAVE_CHUNK_CHARACTERS, type Anchor, type CollaborationTarget, type Command, type DocumentMetadata, type DocumentSnapshot, type Draft, type LiveApplyResponse, type LiveApplyResult, type LiveDocumentInfo, type LiveReadStart, type ReviewThread, type SideleafRPC, type UpdateState, type WindowAction, type WorkspaceInfo, type OpenResult } from "../shared/contracts.ts";
import { EditorBuffer, refreshUntitledRecoveries } from "./workspace.ts";
import { FolderTree } from "./folder-tree.ts";
import { APP_VERSION } from "../shared/version.ts";
import { documentViewMode, isPlainText, type ViewMode } from "../shared/document-type.ts";
import { documentExtensions, documentMode } from "./document-mode.ts";
import { CollaborationError, evaluateApply, focusDraft, liveRevision, threadRevision, threadSemanticValue, type ThreadOperation } from "../collaboration/operations.ts";
import { ActivityJournal, activityForOperation, diffDraftActivity } from "../collaboration/activity.ts";

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const readonly = new Compartment();
const wrapping = new Compartment();
type Setting = "wrapLines" | "autoSave" | "keepScratch" | "minimalLayout" | "hardBreaks";
const settingKeys: Record<Setting, string> = {
  wrapLines: "sideleaf.wrapLines",
  autoSave: "sideleaf.autoSave",
  keepScratch: "sideleaf.keepScratch",
  minimalLayout: "sideleaf.minimalLayout",
  hardBreaks: "sideleaf.hardBreaks",
};
function readSetting(setting: Setting, fallback = true): boolean {
  try { const value = localStorage.getItem(settingKeys[setting]); return value === null ? fallback : value === "true"; }
  catch { return fallback; }
}
const settings: Record<Setting, boolean> = {
  wrapLines: readSetting("wrapLines"),
  autoSave: readSetting("autoSave"),
  keepScratch: readSetting("keepScratch"),
  minimalLayout: readSetting("minimalLayout", false),
  hardBreaks: readSetting("hardBreaks", false),
};
function writeSetting(setting: Setting, value: boolean) {
  settings[setting] = value;
  try { localStorage.setItem(settingKeys[setting], String(value)); } catch { /* Keep the in-memory preference usable. */ }
}
const buffers = new Map<string, EditorBuffer>();
function dropBuffer(id: string) { buffers.delete(id); collaborationActivity?.drop(id); rpc?.send.collaborationClosed({ documentId: id }); }
let workspaceInfo: WorkspaceInfo = { id: "", root: null, name: "Sideleaf", explicit: false, activeId: null };
let folderVisible = false;
let pendingQuit = false;
let recoveryRunning = false;
let current: DocumentMetadata;
let markdownMode: ViewMode = "split";
let savedDoc: Text;
let savedComments = "[]";
let dirty = false;
let busy = false;
let checking = false;
let previewTimer: ReturnType<typeof setTimeout>;
let pendingAnchor: Anchor | null = null;
let pendingGeneration = 0;
let generation = 0;
let localAuthor = "Local user";
let collaborationActivity: ActivityJournal | null = null;
let threadFilter: "open" | "resolved" | "all" = "open";
let previewDirty = true;
let lastScratchJSON: string | null = null;
const collaborationReads = new Map<string, { serialized: string; next: number }>();
// The generation at which lastScratchJSON was written, so idle autosave ticks
// skip serializing an unchanged draft instead of stringifying it to compare.
let lastScratchGeneration = -1;
let pendingExternalOpen = false;
let distractionFree = false;
let distractionFreeTransition = false;
let focusBeforeDistraction: HTMLElement | null = null;
let focusBeforeComments: HTMLElement | null = null;
const zoomStorageKey = "sideleaf.documentZoom";
let documentZoom = storedZoom((() => { try { return localStorage.getItem(zoomStorageKey); } catch { return null; } })());
const systemAppearance = matchMedia("(prefers-color-scheme: dark)");
let themePreference = storedTheme((() => { try { return localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; } })());

function applyTheme(preference: ThemePreference, persist = true) {
  themePreference = preference;
  const resolved = resolveTheme(preference, systemAppearance.matches);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preference));
  });
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Keep the in-memory preference usable. */ }
  }
}
applyTheme(themePreference, false);
systemAppearance.addEventListener("change", () => { if (themePreference === "system") applyTheme("system", false); });
const sideleafHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--syntax-heading)", fontWeight: "600" },
  { tag: [tags.link, tags.url], color: "var(--syntax-link)" },
  { tag: [tags.emphasis, tags.strong], color: "var(--syntax-emphasis)" },
  { tag: [tags.monospace, tags.string], color: "var(--syntax-code)" },
  { tag: [tags.quote, tags.comment], color: "var(--syntax-muted)" },
  { tag: tags.meta, color: "var(--syntax-meta)" },
]);

function applyZoom(value: number, persist = true) {
  documentZoom = normalizeZoom(value);
  document.documentElement.style.setProperty("--document-zoom", String(documentZoom / 100));
  const slider = element<HTMLInputElement>("zoom-slider");
  slider.value = String(documentZoom);
  const reset = element<HTMLButtonElement>("zoom-reset");
  reset.textContent = `${documentZoom}%`;
  if (persist) {
    try { localStorage.setItem(zoomStorageKey, String(documentZoom)); } catch { /* Keep the in-memory zoom usable. */ }
  }
  view?.requestMeasure();
}

const rpc = Electroview.defineRPC<SideleafRPC>({
  maxRequestTime: 120_000,
  handlers: { requests: {
    collaborationDocuments: ({ instanceId }) => collaborationDocuments(instanceId),
    collaborationReadStart: ({ instanceId, target }) => collaborationReadStart(instanceId, target),
    collaborationReadChunk: ({ transferId, index }) => collaborationReadChunk(transferId, index),
    collaborationFocus: ({ instanceId, target, request }) => collaborationFocus(instanceId, target, request),
    collaborationApply: async (payload): Promise<LiveApplyResponse> => {
      try { return { ok: true, result: await collaborationApply(payload) }; }
      catch (error) {
        if (error instanceof CollaborationError) return { ok: false, error: error.message, code: error.code, retryable: error.retryable };
        throw error;
      }
    },
  }, messages: { command: (command) => {
    if (command === "openExternal") { pendingExternalOpen = true; void performPendingExternalOpen(); }
    else void perform(command);
  }, update: renderUpdate, foldersChanged: ({ workspaceId }) => { if (workspaceId === workspaceInfo.id) void folderTree.refresh(); } } },
});
// A person choosing a file must not time out while the host still owns the
// dialog. Other requests retain the bounded timeout for startup diagnostics.
const userDialog = { maxRequestTime: Infinity };
// With the pinned Windows runtime the loopback socket opens but does not deliver
// renderer requests. Use the SDK's native IPC transport on that platform.
class SideleafView extends Electroview<typeof rpc> {
  override initSocketToHost() {
    if (window.__electrobunPlatform !== "windows") super.initSocketToHost();
  }
}
new SideleafView({ rpc });
const platform = window.__electrobunPlatform;
document.body.dataset.platform = platform;
element("menu-distraction-free-shortcut").textContent = customShortcutLabel(platform, "d");
document.querySelectorAll<HTMLElement>("[data-custom-shortcut]").forEach((label) => {
  label.textContent = customShortcutLabel(platform, label.dataset.customShortcut!);
});
document.querySelectorAll<HTMLElement>("[data-layout-shortcut]").forEach((label) => {
  label.textContent = layoutShortcutLabel(platform, label.dataset.layoutShortcut!);
});
element("window-controls").hidden = platform !== "windows";
async function windowAction(action: WindowAction): Promise<boolean> {
  try { await rpc.request.windowAction({ action }); return true; }
  catch (error) { notice((error as Error).message || String(error)); return false; }
}
async function setDistractionFree(enabled: boolean) {
  if (distractionFree === enabled || distractionFreeTransition) return;
  distractionFreeTransition = true;
  try {
    if (!(await windowAction(enabled ? "enter-distraction-free" : "exit-distraction-free"))) return;
    if (enabled) focusBeforeDistraction = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    distractionFree = enabled;
    document.body.dataset.distractionFree = String(enabled);
    element("app-menu").hidden = true;
    element("app-menu-toggle").setAttribute("aria-expanded", "false");
    closeDocumentActions();
    element("settings-panel").hidden = true;
    element("settings-toggle").setAttribute("aria-expanded", "false");
    if (enabled) {
      if (element("workspace").dataset.mode === "read") element<HTMLElement>("preview").parentElement!.focus();
      else view.focus();
    } else if (focusBeforeDistraction?.isConnected) {
      focusBeforeDistraction.focus({ preventScroll: true });
      focusBeforeDistraction = null;
    }
  } finally { distractionFreeTransition = false; }
}
element("window-minimize").addEventListener("click", () => { void windowAction("minimize"); });
element("window-maximize").addEventListener("click", () => { void windowAction("toggle-maximize"); });
element("window-close").addEventListener("click", () => { void windowAction("close"); });
// macOS uses the SDK drag region and native traffic lights. Windows enters
// the system caption loop for snapping and dragging out of maximized state.
if (platform === "macos") {
  element("topbar").addEventListener("dblclick", (event) => {
    if (event.target instanceof Element && !event.target.closest("button, .electrobun-webkit-app-region-no-drag")) {
      void windowAction("titlebar-double-click");
    }
  });
}
if (platform === "windows") {
  const header = element("topbar");
  header.classList.remove("electrobun-webkit-app-region-drag");
  const isCaption = (target: EventTarget | null) => target instanceof Element && !target.closest("button, .electrobun-webkit-app-region-no-drag");
  let lastDown = { at: 0, x: 0, y: 0 };
  header.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !isCaption(event.target)) return;
    event.preventDefault();
    const doubleClick = performance.now() - lastDown.at < 500 && Math.hypot(event.screenX - lastDown.x, event.screenY - lastDown.y) < 5;
    lastDown = { at: doubleClick ? 0 : performance.now(), x: event.screenX, y: event.screenY };
    void windowAction(doubleClick ? "toggle-maximize" : "move");
  });
  header.addEventListener("contextmenu", (event) => {
    if (!isCaption(event.target)) return;
    event.preventDefault();
    void windowAction("system-menu");
  });
  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "Space") {
      event.preventDefault();
      void windowAction("system-menu");
    }
  });
}
rpc.send.diagnostic({ event: "editor-starting", message: "Native bridge attached" });

// The pinned Windows SDK dispatches menu accelerators from CEF, but WebView2
// keeps focus inside its own process. Handle document shortcuts in that view.
// Leave text editing shortcuts with CodeMirror and native comment textareas.
if (window.__electrobunPlatform === "windows") {
  const shortcuts: Partial<Record<string, Command>> = { o: "open", n: "new", w: "close", q: "quit", f: "find" };
  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    const action: Command | undefined = key === "s" ? (event.shiftKey ? "saveAs" : "save")
      : !event.shiftKey ? shortcuts[key] : undefined;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void perform(action);
  }, true);
}

if (platform !== "linux") {
  document.addEventListener("keydown", (event) => {
    const primary = platform === "macos" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!primary || event.altKey || event.isComposing) return;
    const action = zoomActionForCode(event.code);
    if (!action) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) applyZoom(action === "reset" ? DEFAULT_ZOOM : changeZoom(documentZoom, action === "in" ? 1 : -1));
  }, true);
}

if (platform !== "linux") {
  document.addEventListener("keydown", (event) => {
    const action = customShortcutAction(platform, event);
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) void perform(action);
  }, true);
}
if (platform !== "linux") {
  document.addEventListener("keydown", (event) => {
    const action = layoutShortcutAction(platform, event);
    if (!action) return;
    if (document.querySelector("dialog[open]") || event.getModifierState("AltGraph")) return;
    if (action === "toggleComments" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    if (action === "toggleMinimalLayout") applyMinimalLayout(!settings.minimalLayout);
    else if (action === "toggleFolder") void perform("toggleFolder");
    else showComments(element("comments-panel").hidden);
  }, true);
}
document.addEventListener("keydown", (event) => {
  if (!distractionFree || (event.key !== "Escape" && event.code !== "Escape") || event.isComposing) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!event.repeat) void setDistractionFree(false);
}, true);

if (window.__electrobunPlatform !== "linux") {
  const container = element("app-menu-container"), toggle = element<HTMLButtonElement>("app-menu-toggle"), menu = element("app-menu");
  container.hidden = false;
  const menuItems = () => [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].filter((item) => !item.hidden);
  async function refreshWSL() {
    if (platform !== "windows") { element("menu-cli-wsl").hidden = true; return; }
    try { const { wslDistro } = await rpc.request.cliAvailability(); element("menu-cli-wsl").hidden = !wslDistro; } catch { element("menu-cli-wsl").hidden = true; }
  }
  function closeMenu(restoreFocus = false) { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); if (restoreFocus) toggle.focus(); }
  function openMenu(focus: "first" | "last" | null = null) {
    closeSettings();
    closeDocumentActions();
    const items = menuItems(); void refreshWSL(); menu.hidden = false; toggle.setAttribute("aria-expanded", "true");
    if (focus) items[focus === "last" ? items.length - 1 : 0]!.focus();
  }
  toggle.onclick = () => { if (menu.hidden) openMenu(); else closeMenu(true); };
  toggle.onkeydown = (event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); openMenu(event.key === "ArrowUp" ? "last" : "first"); } };
  menu.onkeydown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    else if (event.key === "Tab") closeMenu(true);
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = menuItems();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]!.focus();
    }
  };
  document.addEventListener("pointerdown", (event) => { if (!container.contains(event.target as Node)) closeMenu(); });
  // Do not dismiss on focusout: WebKit may move focus outside the menu before
  // delivering the item's click. Outside pointer input, Escape, and Tab close
  // the menu without racing activation.
  for (const [id, wsl] of [["menu-cli", false], ["menu-cli-wsl", true]] as const) element(id).onclick = () => { closeMenu(true); void rpc.request.installCLI({ wsl }).catch((error) => notice(error.message)); };
  void refreshWSL();
  element("menu-default-editor").onclick = () => { closeMenu(true); showDefaultEditor(); };
  element("menu-distraction-free").onclick = () => { closeMenu(true); void setDistractionFree(true); };
  element("menu-updates").onclick = () => { closeMenu(true); void rpc.request.checkUpdates().then(renderUpdate).catch((error) => notice(error.message)); };
  element("menu-shortcuts").onclick = () => { closeMenu(); const dialog = element<HTMLDialogElement>("shortcuts-dialog"); dialog.showModal(); dialog.focus({ preventScroll: true }); };
  element("menu-help").onclick = () => { closeMenu(true); void rpc.request.openLink({ url: "https://sideleaf.xyz/docs" }).catch((error) => notice(error.message)); };
  element("menu-about").onclick = () => { closeMenu(true); showAbout(); };
}

const documentBar = document.querySelector<HTMLElement>(".document-bar")!;
const documentName = documentBar.querySelector<HTMLElement>(".document-name")!;
const commentsToggle = element<HTMLButtonElement>("comments-toggle");
const folderToggle = element<HTMLButtonElement>("folder-toggle");
const minimalActionsContainer = element("minimal-actions-container");
const minimalActionsToggle = element<HTMLButtonElement>("minimal-actions-toggle");
const minimalActionsMenu = element("minimal-actions-menu");
const minimalCommentsContainer = element("minimal-comments-container");
const minimalCommentsSlot = element("minimal-comments-slot");
const minimalDocumentSlot = element("minimal-document-slot");
const minimalMenuItems = () => [...minimalActionsMenu.querySelectorAll<HTMLButtonElement>("button[role=menuitem], button[role=menuitemradio]")].filter((button) => !button.closest("[hidden]"));

function closeDocumentActions(restoreFocus = false) {
  minimalActionsMenu.hidden = true;
  minimalActionsToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) minimalActionsToggle.focus();
}
function openDocumentActions(focus: "first" | "last" | null = null) {
  element("app-menu").hidden = true;
  element("app-menu-toggle").setAttribute("aria-expanded", "false");
  closeSettings();
  minimalActionsMenu.hidden = false;
  minimalActionsToggle.setAttribute("aria-expanded", "true");
  if (focus) {
    const buttons = minimalMenuItems();
    buttons[focus === "last" ? buttons.length - 1 : 0]!.focus();
  }
}
function applyMinimalLayout(enabled: boolean, persist = true) {
  const active = enabled && platform !== "linux";
  if (persist) writeSetting("minimalLayout", active);
  else settings.minimalLayout = active;
  document.body.dataset.minimalLayout = String(active);
  minimalActionsContainer.hidden = !active;
  minimalCommentsContainer.hidden = !active;
  minimalDocumentSlot.hidden = !active;
  closeDocumentActions();
  if (active) {
    minimalDocumentSlot.append(documentName);
    minimalCommentsSlot.append(folderToggle, commentsToggle);
  } else {
    documentBar.prepend(documentName);
    documentBar.append(folderToggle, commentsToggle);
  }
  const input = document.getElementById("setting-minimal-layout") as HTMLInputElement | null;
  if (input) input.checked = active;
}

minimalActionsToggle.onclick = () => { if (minimalActionsMenu.hidden) openDocumentActions(); else closeDocumentActions(true); };
minimalActionsToggle.onkeydown = (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault(); openDocumentActions(event.key === "ArrowUp" ? "last" : "first");
};
minimalActionsMenu.onkeydown = (event) => {
  if (event.key === "Escape") { event.preventDefault(); closeDocumentActions(true); return; }
  if (event.key === "Tab") { closeDocumentActions(); return; }
  if (["ArrowLeft", "ArrowRight"].includes(event.key) && event.target instanceof HTMLButtonElement && event.target.dataset.mode) {
    event.preventDefault();
    const modes = [...minimalActionsMenu.querySelectorAll<HTMLButtonElement>("button[data-mode]")];
    const index = modes.indexOf(event.target);
    const button = modes[(index + (event.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length]!;
    button.focus(); setMode(button.dataset.mode!, false); return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = minimalMenuItems();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]!.focus();
};
document.addEventListener("pointerdown", (event) => { if (!minimalActionsContainer.contains(event.target as Node)) closeDocumentActions(); });

const settingsContainer = element("settings-container");
const settingsToggle = element<HTMLButtonElement>("settings-toggle");
const settingsPanel = element("settings-panel");
if (platform !== "linux") settingsContainer.hidden = false;
function closeSettings(restoreFocus = false) {
  settingsPanel.hidden = true; settingsToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) settingsToggle.focus();
}
function showSettings() {
  element("app-menu").hidden = true;
  element("app-menu-toggle").setAttribute("aria-expanded", "false");
  closeDocumentActions();
  settingsPanel.hidden = false; settingsToggle.setAttribute("aria-expanded", "true");
}
settingsToggle.onclick = () => { if (settingsPanel.hidden) showSettings(); else closeSettings(true); };
settingsPanel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeSettings(true); } });
document.addEventListener("pointerdown", (event) => { if (!settingsContainer.contains(event.target as Node)) closeSettings(); });
document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
  button.onclick = () => applyTheme(storedTheme(button.dataset.themeChoice ?? null));
});
applyMinimalLayout(settings.minimalLayout, false);
setHardBreaks(settings.hardBreaks);
for (const [id, setting] of [["setting-wrap", "wrapLines"], ["setting-autosave", "autoSave"], ["setting-keep-scratch", "keepScratch"], ["setting-minimal-layout", "minimalLayout"], ["setting-breaks", "hardBreaks"]] as const) {
  const input = element<HTMLInputElement>(id); input.checked = settings[setting];
  input.onchange = async () => {
    if (setting === "minimalLayout") { applyMinimalLayout(input.checked); return; }
    writeSetting(setting, input.checked);
    if (setting === "wrapLines") view.dispatch({ effects: wrapping.reconfigure(input.checked ? EditorView.lineWrapping : []) });
    if (setting === "hardBreaks") { setHardBreaks(input.checked); previewDirty = true; updatePreview(); }
    if (setting === "keepScratch" && !input.checked) {
      lastScratchJSON = null;
      await Promise.allSettled([...buffers.values()].map((buffer) => buffer.saving ?? Promise.resolve(true)));
      await rpc.request.clearScratch({}).catch((error) => notice((error as Error).message));
      for (const buffer of buffers.values()) { buffer.recoveryJSON = null; buffer.recoveryGeneration = -1; }
    }
  };
}

function showAbout() {
  element("about-version").textContent = `Version ${APP_VERSION}`;
  const dialog = element<HTMLDialogElement>("about-dialog");
  dialog.showModal();
  dialog.focus({ preventScroll: true });
}
function showDefaultEditor() {
  if (platform === "windows") { void rpc.request.openDefaultApps().catch((error) => notice(error.message)); return; }
  element<HTMLDialogElement>("default-editor-dialog").showModal();
}
document.querySelectorAll<HTMLButtonElement>("[data-close-dialog]").forEach((button) => {
  button.onclick = () => element<HTMLDialogElement>(button.dataset.closeDialog!).close();
});
element("about-website").onclick = () => { void rpc.request.openLink({ url: "https://sideleaf.xyz/" }).catch((error) => notice(error.message)); };

const view = new EditorView({ parent: element("editor"), state: createEditorState("") });
const folderTree = new FolderTree(element("folder-tree"), element("open-documents"), {
  list: (workspaceId, key) => rpc.request.listFolder({ workspaceId, key }),
  watch: (workspaceId, keys) => rpc.request.watchFolders({ workspaceId, keys }),
  open: (key) => { void run(async () => { applyOpenResult(await rpc.request.openEntry({ workspaceId: workspaceInfo.id, key })); }); },
  activate: (id) => { void run(async () => { const buffer = buffers.get(id); if (!buffer) return; workspaceInfo = await rpc.request.activateDocument({ id }); activateBuffer(buffer); }); },
  close: (id) => { void closeBuffer(id); },
  fileAction: (target, action) => { void fileAction(target, action); },
});
function updateFolderVisibility() {
  const available = !!workspaceInfo.root || buffers.size > 1;
  if (!available) folderVisible = false;
  folderToggle.disabled = !available;
  folderToggle.setAttribute("aria-expanded", String(folderVisible));
  folderToggle.setAttribute("aria-pressed", String(folderVisible));
  folderToggle.setAttribute("aria-label", folderVisible ? "Hide folder" : "Show folder");
  folderToggle.title = `${folderVisible ? "Hide" : "Show"} folder (${layoutShortcutLabel(platform, "f")})`;
  element("folder-panel").hidden = !folderVisible;
  element("folder-name").textContent = workspaceInfo.root ? workspaceInfo.name : "Open documents";
  element("folder-name").title = workspaceInfo.root ?? "";
  element("folder-tree").hidden = !workspaceInfo.root;
  element<HTMLButtonElement>("minimal-close-folder").disabled = !workspaceInfo.root;
  folderTree.setVisible(folderVisible);
}
folderToggle.onclick = () => { void perform("toggleFolder"); };
element("folder-close").onclick = () => { if (folderVisible) void perform("toggleFolder"); };
element("folder-open").onclick = () => { void perform("openFolder"); };
element("folder-empty-open").onclick = () => { void perform("openFolder"); };
element("folder-empty-new").onclick = () => { void perform("new"); };
const folderResize = element("folder-resize");
function folderWidth(width: number, persist = true) {
  width = Math.max(180, Math.min(400, width));
  document.documentElement.style.setProperty("--folder-width", `${width}px`);
  folderResize.setAttribute("aria-valuenow", String(Math.round(width)));
  if (persist) try { localStorage.setItem("sideleaf.folderWidth", String(width)); } catch { /* Retain this window's width. */ }
}
try { const stored = Number(localStorage.getItem("sideleaf.folderWidth")); folderWidth(stored >= 180 ? stored : 230, false); } catch { folderWidth(230, false); }
folderResize.onpointerdown = (event) => { if (event.button !== 0) return; event.preventDefault(); folderResize.setPointerCapture(event.pointerId); };
folderResize.onpointermove = (event) => { if (folderResize.hasPointerCapture(event.pointerId)) folderWidth(event.clientX - element("workspace").getBoundingClientRect().left); };
folderResize.onpointerup = (event) => { if (folderResize.hasPointerCapture(event.pointerId)) folderResize.releasePointerCapture(event.pointerId); };
folderResize.onkeydown = (event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); folderWidth(element("folder-panel").getBoundingClientRect().width + (event.key === "ArrowRight" ? 10 : -10)); };
document.addEventListener("pointerdown", (event) => {
  if (folderVisible && innerWidth < 900 && event.target instanceof Node && !element("folder-panel").contains(event.target) && !folderToggle.contains(event.target)) {
    folderVisible = false; updateFolderVisibility();
  }
});
async function fileAction(target: { key: string } | { id: string }, action: "rename" | "trash") {
  await run(async () => {
    if ("key" in target) applyOpenResult(await rpc.request.openEntry({ workspaceId: workspaceInfo.id, key: target.key }));
    else {
      const buffer = buffers.get(target.id); if (!buffer) return;
      workspaceInfo = await rpc.request.activateDocument({ id: target.id }); activateBuffer(buffer);
    }
    const buffer = captureActive(); if (!buffer?.metadata.path) return;
    if (buffer.saving) await buffer.saving;
    if (action === "trash") {
      if (!(await canLeave(buffer))) return;
      const next = await rpc.request.trashDocument({ id: buffer.metadata.id }, userDialog);
      if (next.document?.id !== buffer.metadata.id) dropBuffer(buffer.metadata.id);
      applyOpenResult(next); void folderTree.refresh(); return;
    }
    const dialog = element<HTMLDialogElement>("rename-dialog"), input = element<HTMLInputElement>("rename-name");
    input.value = buffer.metadata.name; dialog.returnValue = "";
    const name = await new Promise<string | null>((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "rename" ? input.value : null), { once: true });
      dialog.showModal(); input.focus(); input.setSelectionRange(0, input.value.lastIndexOf("."));
    });
    if (name === null) return;
    const metadata = await rpc.request.renameDocument({ id: buffer.metadata.id, name });
    buffer.metadata = metadata; current = metadata; lastScratchGeneration = -1; lastScratchJSON = null; buffer.recoveryGeneration = -1; buffer.recoveryJSON = null;
    applyDocumentType(); refreshDocumentName(); updateDirty(); void folderTree.refresh();
  });
}
const zoomSlider = element<HTMLInputElement>("zoom-slider");
zoomSlider.min = String(MIN_ZOOM); zoomSlider.max = String(MAX_ZOOM); zoomSlider.step = String(ZOOM_STEP);
zoomSlider.oninput = () => applyZoom(Number(zoomSlider.value));
element("zoom-reset").onclick = () => applyZoom(DEFAULT_ZOOM);
applyZoom(documentZoom, false);
rpc.send.diagnostic({ event: "editor-created", message: "CodeMirror initialized" });

function createEditorState(text: string, threads: Draft["threads"] = [], name = "Untitled.md") {
  return EditorState.create({
    doc: text,
    extensions: [
      basicSetup, documentMode.of(documentExtensions(name)), syntaxHighlighting(sideleafHighlight), commentField.init(() => threads), commentHistory, agentHighlightField, wordCountField,
      readonly.of(EditorState.readOnly.of(false)), wrapping.of(settings.wrapLines ? EditorView.lineWrapping : []),
      keymap.of([{ key: "Mod-b", run: () => formatSelection("**") }, { key: "Mod-i", run: () => formatSelection("*") }]),
      EditorView.updateListener.of((update) => {
        if (update.startState.field(commentField) !== update.state.field(commentField) && !update.transactions.some((transaction) => transaction.isUserEvent("input.agent"))) {
          recordHumanThreadChanges(update.startState.field(commentField), update.state.field(commentField));
        }
        if (update.docChanged || update.transactions.some((t) => t.effects.some((e) => e.is(setComments)))) {
          generation++;
          updateDirty();
          if (update.startState.field(commentField) !== update.state.field(commentField)) renderComments();
        }
        if (update.docChanged) {
          updateWordCount(); previewDirty = true;
          clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 180);
        }
        if (update.selectionSet || update.docChanged) updateSelection();
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "calc(14px * var(--document-zoom))", backgroundColor: "var(--paper)", color: "var(--ink)" },
        ".cm-scroller": { overflow: "auto", fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", lineHeight: "1.75" },
        ".cm-content": { padding: "24px 22px 100px", caretColor: "var(--green)" },
        // CodeMirror includes the content padding in its gutter line positions.
        ".cm-gutters": { background: "var(--paper)", color: "var(--faint)", border: "none" },
        ".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 16px", minWidth: "28px" },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--active-line)" },
        "&.cm-focused": { outline: "none" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
        ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--ink)" },
        ".cm-textfield, .cm-button": { color: "var(--ink)", background: "var(--paper)", border: "1px solid var(--border)" },
        ".cm-placeholder": { color: "var(--faint)" },
      }),
    ],
  });
}

function commentsJSON() { return JSON.stringify(view.state.field(commentField)); }
function composerTextarea(threadId: string): HTMLTextAreaElement | null {
  return [...document.querySelectorAll<HTMLTextAreaElement>("textarea[data-composer]")]
    .find((textarea) => textarea.dataset.composer === threadId) ?? null;
}
function focusComposer(buffer: EditorBuffer, selection = buffer.composerSelection): boolean {
  if (!buffer.composer || element("comments-panel").inert) return false;
  const textarea = composerTextarea(buffer.composer.threadId);
  if (!textarea) return false;
  textarea.focus({ preventScroll: true });
  if (selection) textarea.setSelectionRange(selection.start, selection.end);
  buffer.composerFocused = document.activeElement === textarea;
  return buffer.composerFocused;
}
function captureComposer(buffer = buffers.get(current?.id)): void {
  if (!buffer?.composer) return;
  const textarea = composerTextarea(buffer.composer.threadId);
  if (!textarea) return;
  buffer.composer.body = textarea.value;
  buffer.composerSelection = { start: textarea.selectionStart, end: textarea.selectionEnd };
  // Making the panel inert temporarily clears DOM focus. Preserve the user's
  // composer focus intent until the blocking operation re-enables the panel.
  if (!element("comments-panel").inert) buffer.composerFocused = document.activeElement === textarea;
}
function captureActive(): EditorBuffer | undefined {
  const buffer = buffers.get(current?.id);
  if (!buffer) return;
  captureComposer(buffer);
  buffer.state = view.state; buffer.metadata = current; buffer.savedDoc = savedDoc; buffer.savedComments = savedComments;
  buffer.generation = generation; buffer.pendingAnchor = pendingAnchor; buffer.pendingGeneration = pendingGeneration;
  buffer.commentBody = element<HTMLTextAreaElement>("comment-body").value;
  buffer.editorTop = view.scrollDOM.scrollTop; buffer.editorLeft = view.scrollDOM.scrollLeft;
  buffer.previewTop = element("preview").parentElement!.scrollTop;
  buffer.conflict = !element("conflict").hidden;
  buffer.recoveryJSON = lastScratchJSON; buffer.recoveryGeneration = lastScratchGeneration;
  return buffer;
}

function collaborationBuffer(target: CollaborationTarget): EditorBuffer {
  captureActive();
  const matches = [...buffers.values()].filter((buffer) => target.documentId ? buffer.metadata.id === target.documentId : buffer.metadata.path === target.path);
  if (matches.length !== 1) throw new CollaborationError(matches.length ? "The collaboration target is ambiguous." : "This document is not open in Sideleaf.", "NOT_FOUND");
  return matches[0]!;
}

function collaborationInfo(buffer: EditorBuffer, instanceId: string): LiveDocumentInfo {
  return { ...buffer.metadata, active: current.id === buffer.metadata.id, dirty: buffer.dirty || buffer.hasCommentDraft, generation: buffer.generation,
    revision: liveRevision(instanceId, buffer.metadata.id, buffer.generation) };
}

function collaborationDocuments(instanceId: string): LiveDocumentInfo[] {
  captureActive();
  return [...buffers.values()].map((buffer) => collaborationInfo(buffer, instanceId));
}

function collaborationReadStart(instanceId: string, target: CollaborationTarget): LiveReadStart {
  const buffer = collaborationBuffer(target);
  const serialized = JSON.stringify(buffer.draft());
  const cursor = collaborationJournal(instanceId).cursor(buffer.metadata.id);
  const transferId = crypto.randomUUID(), total = Math.max(1, Math.ceil(serialized.length / SAVE_CHUNK_CHARACTERS));
  if (collaborationReads.size >= 4) collaborationReads.delete(collaborationReads.keys().next().value!);
  collaborationReads.set(transferId, { serialized, next: 0 });
  setTimeout(() => collaborationReads.delete(transferId), 10_000);
  return { transferId, total, document: collaborationInfo(buffer, instanceId), cursor };
}

async function collaborationFocus(instanceId: string, target: CollaborationTarget, request: unknown) {
  const buffer = collaborationBuffer(target), draft = buffer.draft();
  const cursor = collaborationJournal(instanceId).cursor(buffer.metadata.id), document = collaborationInfo(buffer, instanceId), focus = focusDraft(draft, request);
  const value = focus.kind === "thread" ? { kind: focus.kind, thread: { ...focus.thread, revision: await threadRevision(focus.thread) } } : focus;
  return { document, cursor, focus: value };
}

function collaborationReadChunk(transferId: string, index: number): string {
  const transfer = collaborationReads.get(transferId);
  if (!transfer || !Number.isSafeInteger(index) || index !== transfer.next) throw new CollaborationError("The live snapshot transfer expired or arrived out of order. Reread the document.", "UNCERTAIN", true);
  const text = transfer.serialized.slice(index * SAVE_CHUNK_CHARACTERS, (index + 1) * SAVE_CHUNK_CHARACTERS);
  transfer.next++;
  if (transfer.next * SAVE_CHUNK_CHARACTERS >= transfer.serialized.length) collaborationReads.delete(transferId);
  return text;
}

async function collaborationApply(payload: { instanceId: string; target: CollaborationTarget; actor: string; ifRevision?: string; ifThreadRevision?: string; envelope: unknown; deadline: number }): Promise<LiveApplyResult> {
  if (Date.now() > payload.deadline) throw new CollaborationError("The apply request expired before the editor could evaluate it. Reread before retrying.", "UNCERTAIN", true);
  const buffer = collaborationBuffer(payload.target), active = current.id === buffer.metadata.id;
  if (busy || buffer.saving || buffer.composerComposing || (active && view.composing)) throw new CollaborationError("Sideleaf is busy with this document. Retry after the current edit or save finishes.", "BUSY", true);
  const guard = buffer.guard();
  const revision = liveRevision(payload.instanceId, buffer.metadata.id, buffer.generation);
  const evaluated = await evaluateApply(buffer.draft(), payload.envelope, { actor: payload.actor, currentRevision: revision,
    ifRevision: payload.ifRevision, ifThreadRevision: payload.ifThreadRevision });
  const activeNow = current.id === buffer.metadata.id;
  if (Date.now() > payload.deadline) throw new CollaborationError("The apply request expired before commit. Reread before retrying.", "UNCERTAIN", true);
  if (buffer.composerComposing || activeNow && view.composing) {
    throw new CollaborationError("Sideleaf is busy with this document. Retry after the current edit finishes.", "BUSY", true);
  }
  if (buffers.get(buffer.metadata.id) !== buffer || !buffer.guardedBy(guard) || busy || buffer.saving) {
    throw new CollaborationError("The document changed while the operation was being checked. Reread before retrying.", "CONFLICT");
  }
  const { changes, highlights, byOperation } = composeAgentChanges(buffer.state.doc.length, evaluated.summary.edits);
  const effects: StateEffect<unknown>[] = [setComments.of(evaluated.draft.threads)];
  if (highlights.length) effects.push(setAgentHighlights.of(highlights));
  const spec = { ...(changes.empty ? {} : { changes }), effects, annotations: isolateHistory.of("full"), userEvent: "input.agent" };
  if (activeNow) { view.dispatch(spec); captureActive(); }
  else {
    buffer.state = buffer.state.update(spec).state;
    buffer.generation++;
    rpc.send.dirty({ id: buffer.metadata.id, dirty: buffer.dirty || buffer.hasCommentDraft });
  }
  const journal = collaborationJournal(payload.instanceId), activity = evaluated.summary.activities.map((item) => {
    const event = journal.record(buffer.metadata.id, activityForOperation(item.kind, payload.actor,
      { threadId: item.threadId, messageId: item.messageId, body: item.body }, item.kind.startsWith("replace") && byOperation.has(item.operation) ? [byOperation.get(item.operation)!] : undefined));
    rpc.send.collaborationActivity(event); return event;
  });
  refreshOpenDocuments();
  if (evaluated.summary.edits.length) notice(`Agent ${payload.actor} applied ${evaluated.summary.edits.length} source change${evaluated.summary.edits.length === 1 ? "" : "s"} to ${buffer.metadata.name}.`);
  return { document: collaborationInfo(buffer, payload.instanceId), operations: evaluated.summary.activities.length, change: evaluated.change, changes: evaluated.summary.changes,
    created: evaluated.summary.created, changed: evaluated.summary.changed, cursor: journal.cursor(buffer.metadata.id), activity, autoSave: settings.autoSave };
}

function collaborationJournal(instanceId: string): ActivityJournal {
  if (!collaborationActivity || collaborationActivity.instanceId !== instanceId) throw new CollaborationError("The collaboration activity session changed. Reread the document.", "UNCERTAIN", true);
  return collaborationActivity;
}

function recordHumanThreadChanges(before: ReviewThread[], after: ReviewThread[]) {
  if (!collaborationActivity || !current?.id) return;
  const now = new Date().toISOString();
  for (const change of diffDraftActivity({ text: "", threads: before }, { text: "", threads: after }, localAuthor)) {
    const event = collaborationActivity.record(current.id, { ...change, actor: localAuthor, createdAt: now });
    rpc.send.collaborationActivity(event);
  }
}
function refreshOpenDocuments() {
  folderTree.setDocuments([...buffers.values()].map((buffer) => ({ id: buffer.metadata.id, name: buffer.metadata.name, path: buffer.metadata.path, dirty: buffer.dirty || buffer.hasCommentDraft, conflict: buffer.conflict, active: current?.id === buffer.metadata.id })));
}
function updateDirty(force = false) {
  if (!current || !savedDoc) return;
  const next = !view.state.doc.eq(savedDoc) || commentsJSON() !== savedComments;
  const buffer = captureActive();
  if (buffer && (next !== dirty || force)) { dirty = next; rpc.send.dirty({ id: current.id, dirty: next || buffer.hasCommentDraft }); }
  if (buffer && !next && !buffer.hasCommentDraft && lastScratchJSON !== null) {
    lastScratchJSON = null; buffer.recoveryJSON = null;
    void rpc.request.clearScratch({ id: current.id }).catch((error) => notice((error as Error).message));
  }
  dirty = next;
  element("unsaved").hidden = !dirty;
  element("status").textContent = busy ? "Working…" : !current.id ? "Choose a file in the folder" : dirty ? "Unsaved changes" : buffer?.hasCommentDraft ? "Unfinished comment" : current.path ? "Saved locally" : "Ready to write";
  element<HTMLButtonElement>("save").disabled = !current.id || busy;
  refreshOpenDocuments();
}
function activateBuffer(buffer: EditorBuffer, capture = true) {
  if (capture) captureActive();
  const scroll = { top: buffer.editorTop, left: buffer.editorLeft, preview: buffer.previewTop };
  current = buffer.metadata; savedDoc = buffer.savedDoc; savedComments = buffer.savedComments;
  generation = buffer.generation; pendingAnchor = buffer.pendingAnchor; pendingGeneration = buffer.pendingGeneration;
  lastScratchJSON = buffer.recoveryJSON; lastScratchGeneration = buffer.recoveryGeneration;
  view.setState(buffer.state);
  view.dispatch({ effects: [readonly.reconfigure(EditorState.readOnly.of(busy)), wrapping.reconfigure(settings.wrapLines ? EditorView.lineWrapping : [])] });
  element<HTMLTextAreaElement>("comment-body").value = buffer.commentBody;
  element("comment-form").hidden = !pendingAnchor; element("comment-quote").textContent = pendingAnchor?.quote ?? "";
  element("conflict").hidden = !buffer.conflict; element("notice").hidden = true;
  if (buffer.error || current.notice) notice(buffer.error ?? current.notice!);
  element("workspace").dataset.empty = "false";
  dirty = buffer.dirty; previewDirty = true;
  applyDocumentType();
  refreshDocumentName(); updateDirty(true); updateWordCount(); updatePreview(); renderComments(); updateSelection();
  if (buffer.hasCommentDraft || buffer.state.field(commentField).length) showComments(true);
  // Restore after the new state's DOM is measured, without scrolling another
  // buffer if a second activation arrives before this frame.
  requestAnimationFrame(() => {
    if (current.id !== buffer.metadata.id) return;
    view.scrollDOM.scrollTop = scroll.top; view.scrollDOM.scrollLeft = scroll.left;
    element("preview").parentElement!.scrollTop = scroll.preview;
  });
  if (!buffer.composerFocused) view.focus();
  void folderTree.reveal(current.path);
}
function applyDocument(snapshot: DocumentSnapshot, recovered = false, previous?: EditorBuffer) {
  const state = createEditorState(snapshot.text, snapshot.threads, snapshot.name);
  const buffer = previous ? EditorBuffer.reloaded(snapshot, state, previous) : new EditorBuffer(snapshot, state, recovered);
  buffers.set(snapshot.id, buffer); activateBuffer(buffer, false);
}
function showEmptyWorkspace() {
  current = { id: "", path: null, name: workspaceInfo.name, lineEnding: "\n", notice: null };
  savedDoc = EditorState.create({ doc: "" }).doc; savedComments = "[]"; dirty = false;
  pendingAnchor = null; element("comment-form").hidden = true; element("conflict").hidden = true; element("notice").hidden = true;
  view.setState(createEditorState("")); view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
  applyDocumentType();
  element("workspace").dataset.empty = "true"; element("folder-empty-name").textContent = workspaceInfo.name;
  refreshDocumentName(); updateDirty(); updateWordCount(); updateSelection(); refreshOpenDocuments();
}
function applyOpenResult(result: OpenResult, replace = false) {
  captureActive();
  if (replace) for (const id of [...buffers.keys()]) dropBuffer(id);
  const changed = workspaceInfo.id !== result.workspace.id;
  workspaceInfo = result.workspace;
  folderTree.setWorkspace(workspaceInfo);
  if (result.document) {
    const existing = buffers.get(result.document.id);
    if (existing) activateBuffer(existing, false); else applyDocument(result.document);
  } else showEmptyWorkspace();
  if (changed && replace) folderVisible = workspaceInfo.explicit;
  updateFolderVisibility(); refreshOpenDocuments();
}
function refreshDocumentName() {
  element("filename").textContent = current.name;
  element("filepath").textContent = current.path ?? (!current.id ? workspaceInfo.root : null) ?? "A little room for your words.";
  element("filepath").title = current.path ?? "";
  element("encoding").textContent = `UTF-8 · ${current.lineEnding === "\r\n" ? "CRLF" : "LF"}`;
}
function notice(message: string) { element("notice-text").textContent = message; element("notice").hidden = false; }
function renderUpdate(state: UpdateState) {
  const container = element("update-notice"), link = element<HTMLButtonElement>("update-link");
  container.hidden = state.status === "idle";
  element("dismiss-update").hidden = state.status === "checking";
  link.disabled = state.status !== "available";
  link.textContent = state.status === "available" ? `v${state.version} available ↗`
    : state.status === "checking" ? "Checking for updates…"
    : state.status === "current" ? "Sideleaf is up to date"
    : "Couldn’t check for updates";
  link.onclick = state.status === "available" ? () => { void rpc.request.openLink({ url: state.url }).catch(() => notice("Couldn’t open the release page.")); } : null;
}
function updateSelection() {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  element<HTMLButtonElement>("add-comment").disabled = !current?.id || busy || (selection.empty && line.length === 0);
  element("selection-status").textContent = selection.empty ? `Ln ${line.number}, Col ${selection.head - line.from + 1}` : `${selection.to - selection.from} selected`;
}
function updatePreview() {
  if (!previewDirty || element("workspace").dataset.mode === "write") return;
  const source = view.state.doc.sliceString(0, PREVIEW_LIMIT);
  const preview = element("preview"), empty = !source.trim();
  preview.parentElement!.classList.toggle("is-empty", empty);
  preview.classList.toggle("is-empty", empty);
  preview.innerHTML = empty ? '<div class="empty-reader"><h1>Make yourself a little space.</h1><img src="./assets/empty-state.png" alt="A young leafy plant growing among quiet hills"><p class="growth-title">Good writing grows here.</p><p class="growth-copy">Ideas take root in quiet spaces.</p></div>' : renderMarkdown(source);
  element("preview-status").textContent = view.state.doc.length > PREVIEW_LIMIT ? "First 200,000 characters" : "Live";
  previewDirty = false;
}
function updateWordCount() {
  const count = view.state.field(wordCountField);
  element("word-count").textContent = `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;
}
function formatSelection(marker: string): boolean {
  if (isPlainText(current?.name)) return true;
  if (busy) return false;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: [{ from, insert: marker }, { from: to, insert: marker }], selection: { anchor: from + marker.length, head: to + marker.length }, userEvent: "input" });
  return true;
}
async function stageDraft<T>(buffer: EditorBuffer, state: EditorState, complete: (transferId: string) => Promise<T>): Promise<T> {
  const transferId = crypto.randomUUID(), id = buffer.metadata.id;
  try {
    const serialized = JSON.stringify({ text: state.doc.toString(), threads: state.field(commentField) });
    const total = Math.ceil(serialized.length / SAVE_CHUNK_CHARACTERS);
    for (let index = 0; index < total; index++) {
      await rpc.request.stageSave({ id, transferId, index, total, text: serialized.slice(index * SAVE_CHUNK_CHARACTERS, (index + 1) * SAVE_CHUNK_CHARACTERS) });
    }
    return await complete(transferId);
  } finally { rpc.send.cancelSave({ transferId }); }
}
async function saveBuffer(buffer: EditorBuffer, saveAs = false): Promise<boolean> {
  if (buffer.saving) await buffer.saving;
  captureActive();
  if (buffer.conflict && !saveAs) throw new Error("This file changed on disk. Reload it or save a copy first.");
  const state = buffer.state, id = buffer.metadata.id, folderKey = folderTree.selectedDirectory;
  const operation = (async () => {
    const result = await stageDraft(buffer, state, (transferId) => rpc.request.save({ id, transferId, saveAs, folderKey }, userDialog));
    if (!result || buffers.get(id) !== buffer) return false;
    buffer.saved(result, state);
    if (current.id === id) {
      current = result; savedDoc = buffer.savedDoc; savedComments = buffer.savedComments;
      applyDocumentType();
      lastScratchJSON = null; lastScratchGeneration = -1;
      element("conflict").hidden = true; element("notice").hidden = true; refreshDocumentName(); updateDirty(true);
    } else {
      buffer.state = buffer.state.update({ effects: documentMode.reconfigure(documentExtensions(result.name)) }).state;
      rpc.send.dirty({ id, dirty: buffer.dirty || buffer.hasCommentDraft });
    }
    workspaceInfo = await rpc.request.workspace(); folderTree.setWorkspace(workspaceInfo);
    updateFolderVisibility(); refreshOpenDocuments();
    return true;
  })();
  buffer.saving = operation;
  try { return await operation; } finally { if (buffer.saving === operation) buffer.saving = null; }
}
async function persistScratch(buffer: EditorBuffer): Promise<boolean> {
  if (!settings.keepScratch || buffer.saving) return false;
  if (buffer.metadata.id === current.id) captureActive();
  const generationAtSave = buffer.generation, state = buffer.state;
  const pending = buffer.pendingReview();
  const serialized = buffer.recoveryPayload();
  if (serialized === buffer.recoveryJSON) return true;
  if (serialized !== buffer.recoveryJSON) {
    const operation = stageDraft(buffer, state, (transferId) => rpc.request.saveScratch({ id: buffer.metadata.id, transferId, pending }));
    buffer.saving = operation;
    try { await operation; } finally { if (buffer.saving === operation) buffer.saving = null; }
  }
  if (buffer.metadata.id === current.id) captureActive();
  if (buffer.markRecovery(serialized, generationAtSave)) {
    if (current.id === buffer.metadata.id) { lastScratchJSON = serialized; lastScratchGeneration = generationAtSave; }
    return true;
  } else {
    if (current.id === buffer.metadata.id) lastScratchGeneration = -1;
  }
  return false;
}
function hasCommentDraft(): boolean { return !!pendingAnchor && !!element<HTMLTextAreaElement>("comment-body").value.trim() || !!buffers.get(current?.id)?.composer?.body.trim(); }
async function canLeave(buffer = captureActive(), keepUntitled = false): Promise<boolean> {
  if (!buffer) return true;
  if (buffer.saving) await buffer.saving;
  captureActive();
  if (keepUntitled && !buffer.metadata.path && settings.keepScratch && (buffer.dirty || buffer.hasCommentDraft)) {
    if (await persistScratch(buffer)) return true;
    notice("The draft changed while Sideleaf was preserving it. It remains open; quit again after the recovery save finishes."); return false;
  }
  if (buffer.hasCommentDraft) {
    if (current.id !== buffer.metadata.id) { workspaceInfo = await rpc.request.activateDocument({ id: buffer.metadata.id }); activateBuffer(buffer); }
    showComments(true); notice("Finish or cancel the review message you are writing before leaving this document.");
    (document.querySelector<HTMLTextAreaElement>("textarea[data-composer]") ?? element<HTMLTextAreaElement>("comment-body")).focus(); return false;
  }
  if (!buffer.dirty) return true;
  const choice = await rpc.request.confirmDiscard({ id: buffer.metadata.id }, userDialog);
  if (choice === "save") return saveBuffer(buffer);
  return choice === "discard";
}
async function canLeaveAll(keepUntitled = false): Promise<boolean> {
  captureActive();
  for (const buffer of buffers.values()) if (!(await canLeave(buffer, keepUntitled))) return false;
  if (keepUntitled && settings.keepScratch) {
    // A later buffer's recovery write may have awaited after an earlier one.
    // Refresh anything that changed during that interval, then require every
    // relevant untitled snapshot to be current before the close can proceed.
    captureActive();
    if (!(await refreshUntitledRecoveries(buffers.values(), persistScratch))) {
      notice("A draft changed while Sideleaf was preserving open documents. It remains open; quit again after recovery finishes."); return false;
    }
    captureActive();
    if ([...buffers.values()].some((buffer) => !buffer.metadata.path && (buffer.dirty || buffer.hasCommentDraft) && buffer.recoveryJSON !== buffer.recoveryPayload())) {
      notice("A draft changed while Sideleaf was preserving open documents. It remains open; quit again after recovery finishes."); return false;
    }
  }
  return true;
}
async function run(operation: () => Promise<void>, blockInput = true) {
  if (busy || !current) return;
  if (view.composing || buffers.get(current.id)?.composerComposing) { notice("Finish entering your current character before opening or saving a file."); return; }
  busy = true;
  if (blockInput) {
    view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
    element("comments-panel").inert = true;
  }
  updateDirty(); updateSelection();
  try { await operation(); }
  catch (error) { notice((error as Error).message || String(error)); }
  finally {
    busy = false;
    if (blockInput) {
      view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(!current.id)) });
      element("comments-panel").inert = false;
      const buffer = buffers.get(current.id);
      if (buffer?.composerFocused) focusComposer(buffer);
    }
    updateDirty(); updateSelection();
    if (pendingQuit) { pendingQuit = false; queueMicrotask(() => { void perform("quit"); }); }
    else if (pendingExternalOpen) queueMicrotask(() => { void performPendingExternalOpen(); });
  }
}
async function performPendingExternalOpen() {
  if (!pendingExternalOpen || busy || !current) return;
  pendingExternalOpen = false;
  await run(async () => {
    const replace = await rpc.request.pendingOpenRequiresLeave();
    if (replace && !(await canLeaveAll())) { await rpc.request.cancelPendingOpen(); return; }
    const next = await rpc.request.openPending();
    if (next) applyOpenResult(next, replace || next.workspace.id !== workspaceInfo.id);
  });
}
async function closeBuffer(id: string) {
  await run(async () => {
    const buffer = buffers.get(id); if (!buffer || !(await canLeave(buffer))) return;
    const next = await rpc.request.closeDocument({ id }); dropBuffer(id); applyOpenResult(next);
  });
}
async function perform(command: Command) {
  if (command === "zoomIn" || command === "zoomOut" || command === "zoomReset") {
    applyZoom(command === "zoomReset" ? DEFAULT_ZOOM : changeZoom(documentZoom, command === "zoomIn" ? 1 : -1)); return;
  }
  if (command === "openExternal") { pendingExternalOpen = true; await performPendingExternalOpen(); return; }
  if (busy || !current) { if (command === "quit") pendingQuit = true; return; }
  if (command === "toggleFolder") {
    if (folderToggle.disabled) return;
    if (distractionFree) { await setDistractionFree(false); folderVisible = true; } else folderVisible = !folderVisible;
    updateFolderVisibility(); if (!folderVisible) view.focus(); return;
  }
  if (command === "modeWrite" || command === "modeSplit" || command === "modeRead") {
    setMode(command === "modeWrite" ? "write" : command === "modeSplit" ? "split" : "read"); return;
  }
  if (command === "distractionFree") { await setDistractionFree(!distractionFree); return; }
  if (command === "about") { showAbout(); return; }
  if (command === "settings") { showSettings(); return; }
  if (command === "makeDefaultEditor") { showDefaultEditor(); return; }
  if (command === "comment") { if (current.id) beginComment(); return; }
  if (command === "find") { if (current.id) openSearchPanel(view); return; }
  if (command === "undo" || command === "redo") { if (current.id) (command === "undo" ? undo : redo)(view); view.focus(); return; }
  if (command === "close") { if (current.id) await closeBuffer(current.id); return; }
  await run(async () => {
    if (command === "save" || command === "saveAs") { const buffer = captureActive(); if (buffer) await saveBuffer(buffer, command === "saveAs"); return; }
    if (command === "quit") {
      if (!(await canLeaveAll(true))) return;
      for (const buffer of buffers.values()) if (buffer.metadata.path) await rpc.request.clearScratch({ id: buffer.metadata.id });
      await rpc.request.finishClose({ quit: true }); return;
    }
    const replace = command === "openFolder" || command === "closeFolder" || !workspaceInfo.explicit;
    if (replace && !(await canLeaveAll())) return;
    if (command === "open") { const next = await rpc.request.open(undefined, userDialog); if (next) applyOpenResult(next, replace); }
    else if (command === "openFolder") { const next = await rpc.request.openFolder(undefined, userDialog); if (next) applyOpenResult(next, true); }
    else if (command === "closeFolder") applyOpenResult(await rpc.request.closeFolder(), true);
    else if (command === "new") applyOpenResult(await rpc.request.newDocument(), replace);
  });
}
function showComments(show: boolean) {
  const panel = element("comments-panel");
  if (show && panel.hidden) focusBeforeComments = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  panel.hidden = !show;
  commentsToggle.setAttribute("aria-expanded", String(show));
  if (!show && focusBeforeComments?.isConnected) {
    focusBeforeComments.focus({ preventScroll: true });
    focusBeforeComments = null;
  }
}
function beginComment() {
  if (busy) return;
  if (hasCommentDraft()) {
    showComments(true);
    notice("Finish or cancel the review message you are writing before starting another.");
    (document.querySelector<HTMLTextAreaElement>("textarea[data-composer]") ?? element<HTMLTextAreaElement>("comment-body")).focus();
    return;
  }
  const selection = view.state.selection.main;
  try {
    const text = view.state.doc.toString();
    const { from, to } = commentRange(text, selection.from, selection.to);
    if (selection.empty) view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    pendingAnchor = makeAnchor(text, from, to);
  }
  catch (error) { notice((error as Error).message); return; }
  pendingGeneration = generation;
  showComments(true); element("comment-form").hidden = false;
  element("comment-quote").textContent = pendingAnchor.quote;
  element<HTMLTextAreaElement>("comment-body").value = "";
  element<HTMLTextAreaElement>("comment-body").focus();
}
function beginThreadComposer(thread: ReviewThread, value: { kind: "reply"; body: string } | { kind: "edit"; messageId: string; body: string }) {
  const buffer = buffers.get(current.id); if (!buffer || busy) return;
  captureActive();
  if (buffer.hasCommentDraft) {
    showComments(true); notice("Finish or cancel the review message you are writing before starting another.");
    (document.querySelector<HTMLTextAreaElement>("textarea[data-composer]") ?? element<HTMLTextAreaElement>("comment-body")).focus(); return;
  }
  buffer.composer = { ...value, threadId: thread.id, baseSemantic: threadSemanticValue(thread) };
  buffer.composerFocused = true; buffer.composerSelection = { start: value.body.length, end: value.body.length };
  buffer.composerComposing = false; buffer.composerRenderPending = false;
  buffer.recoveryGeneration = -1; showComments(true); renderComments(); updateDirty(true);
}
async function applyLocalThreadOperation(operation: ThreadOperation): Promise<void> {
  if (busy) throw new Error("Sideleaf is busy. Try again when the current action finishes.");
  const buffer = captureActive(); if (!buffer) throw new Error("This document is no longer open.");
  if (buffer.composerComposing || view.composing) throw new Error("Finish entering your current character before changing this thread.");
  const guard = buffer.guard();
  const draft = buffer.draft();
  const thread = "threadId" in operation ? draft.threads.find((candidate) => candidate.id === operation.threadId) : undefined;
  if ("threadId" in operation && !thread) throw new Error("This thread is no longer available.");
  const evaluated = await evaluateApply(draft, { operations: [operation] }, { actor: localAuthor, currentRevision: "ui", ifRevision: "ui",
    ...(thread ? { ifThreadRevision: await threadRevision(thread) } : {}) });
  if (buffer.composerComposing || view.composing) throw new Error("Finish entering your current character before changing this thread.");
  if (buffers.get(buffer.metadata.id) !== buffer || current.id !== buffer.metadata.id || !buffer.guardedBy(guard) || busy) {
    throw new Error("The document changed while the review action was being checked. Review the latest thread and try again.");
  }
  view.dispatch({ effects: setComments.of(evaluated.draft.threads), annotations: isolateHistory.of("full"), userEvent: "input" });
  buffer.recoveryGeneration = -1;
  lastScratchGeneration = -1; updateDirty(true);
}
async function confirmDeleteThread(threadId: string, expectedSemantic: string): Promise<boolean> {
  const dialog = element<HTMLDialogElement>("delete-thread-dialog"); dialog.returnValue = "";
  return new Promise<boolean>((resolve) => {
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "delete") { resolve(false); return; }
      const currentThread = view.state.field(commentField).find((thread) => thread.id === threadId);
      if (!currentThread || threadSemanticValue(currentThread) !== expectedSemantic) {
        notice("This thread changed while the confirmation was open. Review it and confirm deletion again."); resolve(false); return;
      }
      resolve(true);
    }, { once: true });
    dialog.showModal(); dialog.focus();
  });
}
function renderComments() {
  const buffer = buffers.get(current?.id);
  if (buffer?.composerComposing) { buffer.composerRenderPending = true; return; }
  captureComposer(buffer);
  const restoreComposerFocus = !!buffer?.composerFocused;
  const restoreComposerSelection = buffer?.composerSelection ? { ...buffer.composerSelection } : null;
  const threads = view.state.field(commentField);
  const counts = { open: threads.filter((thread) => thread.state === "open").length, resolved: threads.filter((thread) => thread.state === "resolved").length, all: threads.length };
  element("comment-count").textContent = String(counts.open);
  document.querySelectorAll<HTMLButtonElement>("[data-thread-filter]").forEach((button) => {
    const filter = button.dataset.threadFilter as keyof typeof counts;
    button.setAttribute("aria-pressed", String(filter === threadFilter));
    button.querySelector("span")!.textContent = String(counts[filter]);
  });
  const list = element("comments-list"); list.replaceChildren();
  const visible = threads.filter((thread) => threadFilter === "all" || thread.state === threadFilter || buffer?.composer?.threadId === thread.id);
  if (!visible.length) {
    const empty = document.createElement("p"); empty.className = "empty-comments";
    empty.textContent = threads.length ? `No ${threadFilter} threads.` : "Select a passage in the editor, then start a review thread."; list.append(empty);
  }
  const renderComposer = (thread: ReviewThread | null, parent: HTMLElement) => {
    if (!buffer?.composer || buffer.composer.threadId !== (thread?.id ?? buffer.composer.threadId)) return;
    const composer = buffer.composer;
    const wrapper = document.createElement("form"); wrapper.className = "thread-composer";
    const target = thread && (composer.kind === "reply" || thread.messages.some((message) => message.id === composer.messageId));
    const changed = !!target && threadSemanticValue(thread) !== composer.baseSemantic;
    const label = document.createElement("label"); label.textContent = !target ? "This thread or message is no longer available. Copy or cancel your saved draft." : composer.kind === "reply" ? "Reply" : "Edit message";
    const textarea = document.createElement("textarea"); textarea.maxLength = 20_000; textarea.value = composer.body; textarea.dataset.composer = composer.threadId;
    textarea.setAttribute("aria-label", label.textContent);
    textarea.readOnly = !target;
    textarea.addEventListener("input", () => { composer.body = textarea.value; buffer.recoveryGeneration = -1; lastScratchGeneration = -1; submit.disabled = changed || !textarea.value.trim(); updateDirty(true); });
    textarea.addEventListener("compositionstart", () => { buffer.composerComposing = true; buffer.composerFocused = true; });
    textarea.addEventListener("compositionend", () => {
      buffer.composerComposing = false; composer.body = textarea.value;
      buffer.composerSelection = { start: textarea.selectionStart, end: textarea.selectionEnd };
      buffer.recoveryGeneration = -1; lastScratchGeneration = -1;
      const deferred = buffer.composerRenderPending; buffer.composerRenderPending = false;
      if (deferred) renderComments();
      updateDirty(true);
    });
    wrapper.append(label, textarea);
    if (changed) {
      const warning = document.createElement("p"); warning.className = "composer-conflict";
      warning.textContent = "This thread changed while you were writing. Review the latest messages before sending."; wrapper.append(warning);
    }
    const actions = document.createElement("div"); actions.className = "thread-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
    cancel.onclick = () => { buffer.composer = null; buffer.composerFocused = false; buffer.composerComposing = false; buffer.composerRenderPending = false; buffer.recoveryGeneration = -1; renderComments(); updateDirty(true); };
    actions.append(cancel);
    if (changed) {
      const reconcile = document.createElement("button"); reconcile.type = "button"; reconcile.textContent = "Use latest thread";
      reconcile.onclick = () => { composer.baseSemantic = threadSemanticValue(thread!); renderComments(); };
      actions.append(reconcile);
    }
    const submit = document.createElement("button");
    if (target) {
      submit.className = "primary"; submit.type = "submit"; submit.textContent = composer.kind === "reply" ? "Reply" : "Save edit";
      submit.disabled = changed || !composer.body.trim(); actions.append(submit);
      wrapper.onsubmit = (event) => { event.preventDefault(); if (changed || !composer.body.trim()) return;
        const operation: ThreadOperation = composer.kind === "reply"
          ? { kind: "thread-reply", threadId: thread!.id, body: composer.body.trim() }
          : { kind: "thread-message-update", threadId: thread!.id, messageId: composer.messageId!, body: composer.body.trim() };
        void applyLocalThreadOperation(operation).then(() => { buffer.composer = null; buffer.composerFocused = false; buffer.composerComposing = false; buffer.composerRenderPending = false; buffer.recoveryGeneration = -1; renderComments(); updateDirty(true); }).catch((error) => notice(error.message));
      };
    }
    wrapper.append(actions); parent.append(wrapper);
  };
  for (const thread of visible) {
    const card = document.createElement("section"); card.className = "comment-card"; card.dataset.state = thread.state;
    const label = document.createElement("span"); label.className = "comment-label";
    label.textContent = `${thread.state.toUpperCase()} · ${thread.anchor.state === "attached" ? "ON THIS PASSAGE" : "UNANCHORED"}`;
    const quote = document.createElement("button"); quote.className = "comment-quote"; quote.textContent = thread.anchor.quote;
    quote.disabled = thread.anchor.state === "orphaned";
    quote.onclick = () => { view.dispatch({ selection: { anchor: thread.anchor.from, head: thread.anchor.to }, scrollIntoView: true }); setMode("split"); view.focus(); };
    card.append(label, quote);
    for (const [messageIndex, message] of thread.messages.entries()) {
      const container = document.createElement("article"); container.className = "thread-message";
      const header = document.createElement("header"), author = document.createElement("strong"), timestamp = document.createElement("span");
      author.textContent = message.author ?? "Unknown author"; timestamp.textContent = message.updatedAt ? `edited ${message.updatedAt}` : message.createdAt;
      header.append(author, timestamp);
      const body = document.createElement("p"); body.textContent = message.body;
      const actions = document.createElement("div"); actions.className = "message-actions";
      const edit = document.createElement("button"); edit.textContent = "Edit";
      edit.onclick = () => beginThreadComposer(thread, { kind: "edit", messageId: message.id, body: message.body }); actions.append(edit);
      if (messageIndex > 0) {
        const remove = document.createElement("button"); remove.textContent = "Delete reply";
        remove.onclick = () => { void applyLocalThreadOperation({ kind: "thread-message-delete", threadId: thread.id, messageId: message.id }).catch((error) => notice(error.message)); };
        actions.append(remove);
      }
      container.append(header, body, actions); card.append(container);
    }
    const actions = document.createElement("div"); actions.className = "thread-actions";
    const reply = document.createElement("button"); reply.textContent = "Reply"; reply.onclick = () => beginThreadComposer(thread, { kind: "reply", body: "" });
    const state = document.createElement("button"); state.textContent = thread.state === "open" ? "Resolve" : "Reopen";
    state.onclick = () => { void applyLocalThreadOperation({ kind: thread.state === "open" ? "thread-resolve" : "thread-reopen", threadId: thread.id }).catch((error) => notice(error.message)); };
    const remove = document.createElement("button"); remove.textContent = "Delete thread";
    remove.onclick = () => { const expected = threadSemanticValue(thread); void confirmDeleteThread(thread.id, expected).then(async (confirmed) => { if (confirmed) await applyLocalThreadOperation({ kind: "thread-delete", threadId: thread.id }); }).catch((error) => notice(error.message)); };
    actions.append(reply, state, remove); card.append(actions);
    renderComposer(thread, card); list.append(card);
  }
  if (buffer?.composer && !threads.some((thread) => thread.id === buffer.composer!.threadId)) {
    const unavailable = document.createElement("section"); unavailable.className = "comment-card"; renderComposer(null, unavailable); list.prepend(unavailable);
  }
  if (restoreComposerFocus && buffer?.composer) {
    focusComposer(buffer, restoreComposerSelection);
  }
}
function applyDocumentType() {
  const plain = isPlainText(current.name);
  document.querySelectorAll<HTMLElement>(".view-switch, .minimal-view-switch").forEach((control) => { control.hidden = plain; });
  element("setting-breaks-row").hidden = plain;
  element("source-label").textContent = plain ? "TEXT" : "MARKDOWN";
  document.querySelector(".editor-pane")!.setAttribute("aria-label", plain ? "Text source" : "Markdown source");
  view.dispatch({ effects: documentMode.reconfigure(documentExtensions(current.name)) });
  setMode(markdownMode, false);
}
function setMode(requested: string, focusDocument = true) {
  const mode = documentViewMode(current?.name ?? "Untitled.md", requested === "write" || requested === "read" ? requested : "split");
  if (!isPlainText(current?.name)) markdownMode = mode;
  element("workspace").dataset.mode = mode;
  if (mode !== "write") updatePreview();
  document.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((button) => {
    button.setAttribute(button.getAttribute("role") === "menuitemradio" ? "aria-checked" : "aria-pressed", String(button.dataset.mode === mode));
  });
  if (focusDocument && mode !== "read") view.focus();
  else if (focusDocument && distractionFree) element<HTMLElement>("preview").parentElement!.focus();
}
for (const action of ["new", "open", "openFolder", "find", "save"] as const) element(action).onclick = () => { closeDocumentActions(); void perform(action); };
for (const [id, action] of [["minimal-new", "new"], ["minimal-open", "open"], ["minimal-open-folder", "openFolder"], ["minimal-close-folder", "closeFolder"], ["minimal-close", "close"], ["minimal-save", "save"], ["minimal-save-as", "saveAs"], ["minimal-find", "find"]] as const) {
  element(id).onclick = () => { closeDocumentActions(); void perform(action); };
}
document.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((button) => {
  button.onclick = () => {
    const fromMinimalMenu = minimalActionsMenu.contains(button);
    if (fromMinimalMenu) closeDocumentActions();
    setMode(button.dataset.mode!);
    if (fromMinimalMenu && button.dataset.mode === "read") element<HTMLElement>("preview").parentElement!.focus();
  };
});
element("add-comment").onclick = beginComment;
commentsToggle.onclick = () => showComments(element("comments-panel").hidden);
element("comments-close").onclick = () => showComments(false);
document.querySelectorAll<HTMLButtonElement>("[data-thread-filter]").forEach((button) => {
  button.onclick = () => { threadFilter = button.dataset.threadFilter as typeof threadFilter; renderComments(); };
});
element("dismiss-notice").onclick = () => { element("notice").hidden = true; };
element("dismiss-update").onclick = () => { void rpc.request.dismissUpdate(); };
element("comment-body").addEventListener("input", () => {
  const buffer = buffers.get(current.id);
  if (buffer) { buffer.commentBody = element<HTMLTextAreaElement>("comment-body").value; buffer.recoveryGeneration = -1; }
  lastScratchGeneration = -1; updateDirty(true);
});
element("cancel-comment").onclick = () => { pendingAnchor = null; element("comment-form").hidden = true; const buffer = buffers.get(current.id); if (buffer) buffer.recoveryGeneration = -1; lastScratchGeneration = -1; updateDirty(true); view.focus(); };
element("comment-form").onsubmit = (event) => {
  event.preventDefault();
  const body = element<HTMLTextAreaElement>("comment-body").value.trim();
  if (!pendingAnchor || !body || busy) return;
  if (generation !== pendingGeneration) { notice("The document changed while you wrote this comment. Select the passage again before adding it."); return; }
  const anchor = pendingAnchor;
  void applyLocalThreadOperation({ kind: "thread-add", from: anchor.from, to: anchor.to, body }).then(() => {
    pendingAnchor = null; element("comment-form").hidden = true; lastScratchGeneration = -1; updateDirty(true); view.focus();
  }).catch((error) => notice(error.message));
};
element("save-copy").onclick = () => { void perform("saveAs"); };
element("reload").onclick = () => { void run(async () => {
  const previous = captureActive();
  if (!previous || !(await canLeave(previous))) return;
  const snapshot = await rpc.request.reload({ id: previous.metadata.id });
  if (buffers.get(previous.metadata.id) === previous) applyDocument(snapshot, false, previous);
}); };
element("preview").onclick = (event) => {
  const link = (event.target as HTMLElement).closest("a"); if (!link) return;
  event.preventDefault(); const url = link.getAttribute("href");
  if (url && /^(https?:|mailto:)/i.test(url)) void rpc.request.openLink({ url }).catch((error) => notice(error.message));
};

setInterval(() => { void checkDisk(); }, 2000);
setInterval(() => { if (folderVisible) void folderTree.refresh(); }, 10_000);
setInterval(() => {
  if (!settings.autoSave || busy || !current || view.composing) return;
  captureActive();
  void (async () => {
    for (const buffer of buffers.values()) {
      if (busy || view.composing) break;
      if (!buffer.dirty || !buffer.metadata.path || buffer.saving || buffer.conflict) continue;
      try { await saveBuffer(buffer); }
      catch (error) { buffer.error = `Could not save ${buffer.metadata.name}: ${(error as Error).message}`; notice(buffer.error); }
    }
    refreshOpenDocuments();
  })();
}, 30_000);
setInterval(() => {
  if (!settings.keepScratch || busy || recoveryRunning || !current || view.composing) return;
  captureActive(); recoveryRunning = true;
  void (async () => {
    try { for (const buffer of buffers.values()) if ((buffer.dirty || buffer.hasCommentDraft) && !buffer.saving) await persistScratch(buffer); }
    catch (error) { notice(`Draft recovery failed: ${(error as Error).message}`); }
    finally { recoveryRunning = false; }
  })();
}, 5000);
async function checkDisk() {
  if (busy || checking || !current || view.composing || buffers.get(current.id)?.composerComposing) return;
  captureActive(); checking = true;
  try {
    for (const buffer of buffers.values()) {
      const id = buffer.metadata.id;
      if (!buffer.metadata.path || buffer.saving || busy) continue;
      const state = buffer.state;
      const result = await rpc.request.check({ id });
      if (buffers.get(id) !== buffer || buffer.saving || busy) continue;
      if (current.id === id) captureActive();
      if (!result.changed) { buffer.conflict = false; if (current.id === id) element("conflict").hidden = true; continue; }
      if (buffer.dirty || buffer.hasCommentDraft || result.error || buffer.state.doc !== state.doc) {
        buffer.conflict = true; buffer.error = result.error;
        if (current.id === id) { element("conflict").hidden = false; if (result.error) notice(result.error); }
      } else {
        await run(async () => {
          if (current.id === id) captureActive();
          if (buffer.dirty || buffer.hasCommentDraft || buffer.saving) return;
          const snapshot = await rpc.request.reload({ id });
          if (buffers.get(id) !== buffer) return;
          const next = EditorBuffer.reloaded(snapshot, createEditorState(snapshot.text, snapshot.threads), buffer);
          buffers.set(id, next);
          if (current.id === id) { activateBuffer(next, false); notice("Reloaded changes made outside Sideleaf."); }
        });
      }
    }
    refreshOpenDocuments();
  } catch (error) { notice((error as Error).message); }
  finally { checking = false; }
}

async function initialize() {
  try {
    const initial = await rpc.request.initial({ restoreScratch: settings.keepScratch });
    localAuthor = initial.localAuthor;
    collaborationActivity = new ActivityJournal(initial.collaborationInstanceId);
    workspaceInfo = initial.workspace;
    folderTree.setWorkspace(workspaceInfo);
    for (const recovered of initial.recovered) {
      const buffer = new EditorBuffer(recovered.document, createEditorState(recovered.document.text, recovered.document.threads), true);
      buffer.originalPath = recovered.originalPath;
      if (recovered.pending?.comment) { buffer.pendingAnchor = recovered.pending.comment.anchor; buffer.commentBody = recovered.pending.comment.body; buffer.pendingGeneration = recovered.pending.comment.valid ? buffer.generation : -1; }
      if (recovered.pending?.composer) { buffer.composer = recovered.pending.composer; buffer.composerFocused = true; }
      rpc.send.dirty({ id: buffer.metadata.id, dirty: buffer.dirty || buffer.hasCommentDraft });
      if (recovered.originalPath) { buffer.metadata.name = `${recovered.originalPath.split(/[\\/]/).at(-1)} (recovered)`; buffer.metadata.notice = `Recovered unsaved changes from ${recovered.originalPath}. Save a copy to keep them; the original file was not changed.`; }
      buffers.set(buffer.metadata.id, buffer);
    }
    if (initial.document) { const existing = buffers.get(initial.document.id); if (existing) activateBuffer(existing, false); else applyDocument(initial.document); }
    else showEmptyWorkspace();
    folderVisible = workspaceInfo.explicit || initial.recovered.length > 1;
    updateFolderVisibility();
    if (initial.recoveryError) notice(initial.recoveryError);
    renderUpdate(await rpc.request.updateState());
    rpc.send.ready({ userAgent: navigator.userAgent });
    if (pendingExternalOpen) void performPendingExternalOpen();
  } catch (error) {
    const message = `Sideleaf could not start: ${(error as Error).message}`;
    notice(message);
    rpc.send.diagnostic({ event: "editor-failed", message });
  }
}
void initialize();
