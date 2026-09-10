import "./bootstrap.ts";
import { Electroview } from "electrobun/view";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, Prec, type Text } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { redo, undo, isolateHistory } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { commentField, commentHistory, setComments } from "./comments.ts";
import { PREVIEW_LIMIT, renderMarkdown } from "./markdown.ts";
import { wordCountField } from "./word-count.ts";
import { commentRange, makeAnchor } from "../document/anchors.ts";
import { documentMetadata, SAVE_CHUNK_CHARACTERS, type Anchor, type Command, type DocumentMetadata, type DocumentSnapshot, type Draft, type SideleafRPC, type UpdateState, type WindowAction } from "../shared/contracts.ts";
import { APP_VERSION } from "../shared/version.ts";

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const readonly = new Compartment();
const wrapping = new Compartment();
type Setting = "wrapLines" | "autoSave" | "keepScratch";
const settingKeys: Record<Setting, string> = {
  wrapLines: "sideleaf.wrapLines",
  autoSave: "sideleaf.autoSave",
  keepScratch: "sideleaf.keepScratch",
};
function readSetting(setting: Setting): boolean {
  try { const value = localStorage.getItem(settingKeys[setting]); return value === null ? true : value === "true"; }
  catch { return true; }
}
const settings: Record<Setting, boolean> = {
  wrapLines: readSetting("wrapLines"),
  autoSave: readSetting("autoSave"),
  keepScratch: readSetting("keepScratch"),
};
function writeSetting(setting: Setting, value: boolean) {
  settings[setting] = value;
  try { localStorage.setItem(settingKeys[setting], String(value)); } catch { /* Keep the in-memory preference usable. */ }
}
let current: DocumentMetadata;
let savedDoc: Text;
let savedComments = "[]";
let dirty = false;
let busy = false;
let checking = false;
let previewTimer: ReturnType<typeof setTimeout>;
let pendingAnchor: Anchor | null = null;
let pendingGeneration = 0;
let generation = 0;
let previewDirty = true;
let lastScratchJSON: string | null = null;
let pendingExternalOpen = false;
let distractionFree = false;
let distractionFreeTransition = false;
let focusBeforeDistraction: HTMLElement | null = null;

const rpc = Electroview.defineRPC<SideleafRPC>({
  maxRequestTime: 120_000,
  handlers: { messages: { command: (command) => {
    if (command === "openExternal") { pendingExternalOpen = true; void performPendingExternalOpen(); }
    else void perform(command);
  }, update: renderUpdate } },
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
  const shortcuts: Record<string, () => void> = {
    w: () => setMode("write"),
    s: () => setMode("split"),
    r: () => setMode("read"),
    c: beginComment,
    d: () => { void setDistractionFree(!distractionFree); },
  };
  document.addEventListener("keydown", (event) => {
    const primary = platform === "macos" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!primary || !event.altKey || event.shiftKey || event.isComposing) return;
    const action = shortcuts[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) action();
  }, true);
}
document.addEventListener("keydown", (event) => {
  if (!distractionFree || event.key !== "Escape" || event.isComposing) return;
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
  element("menu-website").onclick = () => { closeMenu(true); void rpc.request.openLink({ url: "https://sideleaf.xyz/" }).catch((error) => notice(error.message)); };
  element("menu-about").onclick = () => { closeMenu(true); showAbout(); };
}

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
  settingsPanel.hidden = false; settingsToggle.setAttribute("aria-expanded", "true");
}
settingsToggle.onclick = () => { if (settingsPanel.hidden) showSettings(); else closeSettings(true); };
settingsPanel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeSettings(true); } });
document.addEventListener("pointerdown", (event) => { if (!settingsContainer.contains(event.target as Node)) closeSettings(); });
element("settings-close").onclick = () => closeSettings(true);
for (const [id, setting] of [["setting-wrap", "wrapLines"], ["setting-autosave", "autoSave"], ["setting-keep-scratch", "keepScratch"]] as const) {
  const input = element<HTMLInputElement>(id); input.checked = settings[setting];
  input.onchange = () => {
    writeSetting(setting, input.checked);
    if (setting === "wrapLines") view.dispatch({ effects: wrapping.reconfigure(input.checked ? EditorView.lineWrapping : []) });
    if (setting === "keepScratch" && !input.checked) {
      lastScratchJSON = null;
      void rpc.request.clearScratch().catch((error) => notice((error as Error).message));
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
rpc.send.diagnostic({ event: "editor-created", message: "CodeMirror initialized" });

function createEditorState(text: string, comments: Draft["comments"] = []) {
  return EditorState.create({
    doc: text,
    extensions: [
      Prec.highest(keymap.of([{ key: "Mod-Shift-m", run: () => { beginComment(); return true; } }])),
      basicSetup, markdown(), commentField.init(() => comments), commentHistory, wordCountField,
      readonly.of(EditorState.readOnly.of(false)), wrapping.of(settings.wrapLines ? EditorView.lineWrapping : []),
      placeholder("# A fresh page\n\nStart writing, or open a Markdown file."),
      EditorView.contentAttributes.of({ "aria-label": "Markdown editor", spellcheck: "true", autocapitalize: "off", autocorrect: "off" }),
      keymap.of([{ key: "Mod-b", run: () => formatSelection("**") }, { key: "Mod-i", run: () => formatSelection("*") }]),
      EditorView.updateListener.of((update) => {
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
        "&": { height: "100%", fontSize: "14px", backgroundColor: "var(--paper)", color: "var(--ink)" },
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

function draft(): Draft { return { text: view.state.doc.toString(), comments: view.state.field(commentField) }; }
function commentsJSON() { return JSON.stringify(view.state.field(commentField)); }
function updateDirty() {
  if (!current || !savedDoc) return;
  const next = !view.state.doc.eq(savedDoc) || commentsJSON() !== savedComments;
  if (next !== dirty) { dirty = next; rpc.send.dirty({ id: current.id, dirty }); }
  if (!next && !current.path && lastScratchJSON !== null) {
    lastScratchJSON = null;
    void rpc.request.clearScratch().catch((error) => notice((error as Error).message));
  }
  element("unsaved").hidden = !dirty;
  element("status").textContent = busy ? "Working…" : dirty ? "Unsaved changes" : current.path ? "Saved locally" : "Ready to write";
}
function applyDocument(snapshot: DocumentSnapshot, recovered = false) {
  current = documentMetadata(snapshot);
  view.setState(createEditorState(snapshot.text, snapshot.comments));
  savedDoc = recovered ? EditorState.create({ doc: "" }).doc : view.state.doc;
  savedComments = recovered ? "[]" : commentsJSON();
  lastScratchJSON = recovered ? JSON.stringify(draft()) : null;
  dirty = false; generation++;
  pendingAnchor = null; element("comment-form").hidden = true; element("conflict").hidden = true;
  previewDirty = true;
  refreshDocumentName(); updateDirty(); updateWordCount(); updatePreview(); renderComments(); updateSelection();
  if (snapshot.notice) notice(snapshot.notice); else element("notice").hidden = true;
  if (snapshot.comments.length) showComments(true);
  view.focus();
}
function refreshDocumentName() {
  element("filename").textContent = current.name;
  element("filepath").textContent = current.path ?? "A little room for your words.";
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
  element<HTMLButtonElement>("add-comment").disabled = busy || (selection.empty && line.length === 0);
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
  if (busy) return false;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: [{ from, insert: marker }, { from: to, insert: marker }], selection: { anchor: from + marker.length, head: to + marker.length }, userEvent: "input" });
  return true;
}
async function stageDraft<T>(complete: (transferId: string) => Promise<T>): Promise<T> {
  const transferId = crypto.randomUUID();
  try {
    const serialized = JSON.stringify(draft());
    const total = Math.ceil(serialized.length / SAVE_CHUNK_CHARACTERS);
    for (let index = 0; index < total; index++) {
      await rpc.request.stageSave({ id: current.id, transferId, index, total, text: serialized.slice(index * SAVE_CHUNK_CHARACTERS, (index + 1) * SAVE_CHUNK_CHARACTERS) });
    }
    return await complete(transferId);
  } finally { rpc.send.cancelSave({ transferId }); }
}
async function save(saveAs = false): Promise<boolean> {
  const result = await stageDraft((transferId) => rpc.request.save({ id: current.id, transferId, saveAs }, userDialog));
  if (!result) return false;
  current = result; savedDoc = view.state.doc; savedComments = commentsJSON();
  lastScratchJSON = null;
  element("conflict").hidden = true; element("notice").hidden = true;
  refreshDocumentName(); updateDirty(); return true;
}
async function persistScratch(): Promise<void> {
  if (current.path || !settings.keepScratch) return;
  const serialized = JSON.stringify(draft());
  if (serialized === lastScratchJSON) return;
  await stageDraft((transferId) => rpc.request.saveScratch({ id: current.id, transferId }));
  lastScratchJSON = serialized;
}
async function clearScratch(): Promise<void> {
  lastScratchJSON = null;
  await rpc.request.clearScratch();
}
function hasCommentDraft(): boolean {
  return !!pendingAnchor && !!element<HTMLTextAreaElement>("comment-body").value.trim();
}
async function canLeave(): Promise<boolean> {
  if (hasCommentDraft()) {
    showComments(true);
    notice("Add or cancel the comment you are writing before leaving this document.");
    element<HTMLTextAreaElement>("comment-body").focus();
    return false;
  }
  if (!dirty) return true;
  const choice = await rpc.request.confirmDiscard(undefined, userDialog);
  if (choice === "save") return save();
  if (choice !== "discard") return false;
  if (!current.path) await clearScratch();
  return true;
}
async function run(operation: () => Promise<void>) {
  if (busy || !current) return;
  if (view.composing) { notice("Finish entering your current character before opening or saving a file."); return; }
  busy = true; view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
  updateDirty(); updateSelection();
  try { await operation(); }
  catch (error) { notice((error as Error).message || String(error)); }
  finally {
    busy = false; view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(false)) }); updateDirty(); updateSelection();
    if (pendingExternalOpen) queueMicrotask(() => { void performPendingExternalOpen(); });
  }
}
async function performPendingExternalOpen() {
  if (!pendingExternalOpen || busy || !current) return;
  pendingExternalOpen = false;
  await run(async () => {
    if (!(await canLeave())) { await rpc.request.cancelPendingOpen(); return; }
    const next = await rpc.request.openPending();
    if (next) applyDocument(next);
  });
}
async function perform(command: Command) {
  if (busy || !current) return;
  if (command === "openExternal") { pendingExternalOpen = true; await performPendingExternalOpen(); return; }
  if (command === "modeWrite" || command === "modeSplit" || command === "modeRead") {
    setMode(command === "modeWrite" ? "write" : command === "modeSplit" ? "split" : "read"); return;
  }
  if (command === "distractionFree") { await setDistractionFree(!distractionFree); return; }
  if (command === "about") { showAbout(); return; }
  if (command === "settings") { showSettings(); return; }
  if (command === "makeDefaultEditor") { showDefaultEditor(); return; }
  if (command === "comment") { beginComment(); return; }
  if (command === "find") { openSearchPanel(view); return; }
  if (command === "undo" || command === "redo") { (command === "undo" ? undo : redo)(view); view.focus(); return; }
  await run(async () => {
    if (command === "save" || command === "saveAs") { await save(command === "saveAs"); return; }
    if (command === "quit" && !current.path && dirty && settings.keepScratch) {
      if (hasCommentDraft()) {
        showComments(true);
        notice("Add or cancel the comment you are writing before quitting Sideleaf.");
        element<HTMLTextAreaElement>("comment-body").focus();
        return;
      }
      await persistScratch();
      await rpc.request.finishClose({ quit: true });
      return;
    }
    if (!(await canLeave())) return;
    if (command === "open") { const next = await rpc.request.open(undefined, userDialog); if (next) applyDocument(next); }
    else if (command === "new" || command === "close") applyDocument(await rpc.request.newDocument());
    else await rpc.request.finishClose({ quit: true });
  });
}
function showComments(show: boolean) {
  element("comments-panel").hidden = !show;
  element("comments-toggle").setAttribute("aria-expanded", String(show));
}
function beginComment() {
  if (busy) return;
  if (hasCommentDraft()) {
    showComments(true);
    notice("Add or cancel the comment you are writing before starting another.");
    element<HTMLTextAreaElement>("comment-body").focus();
    return;
  }
  const selection = view.state.selection.main;
  try {
    const { from, to } = commentRange(view.state.doc.toString(), selection.from, selection.to);
    if (selection.empty) view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    pendingAnchor = makeAnchor(view.state.doc.toString(), from, to);
  }
  catch (error) { notice((error as Error).message); return; }
  pendingGeneration = generation;
  showComments(true); element("comment-form").hidden = false;
  element("comment-quote").textContent = pendingAnchor.quote;
  element<HTMLTextAreaElement>("comment-body").value = "";
  element<HTMLTextAreaElement>("comment-body").focus();
}
function renderComments() {
  const comments = view.state.field(commentField);
  element("comment-count").textContent = String(comments.length);
  const list = element("comments-list"); list.replaceChildren();
  if (!comments.length) {
    const empty = document.createElement("p"); empty.className = "empty-comments";
    empty.textContent = "Select a passage in the editor, then add a comment. Keep your thoughts beside your words."; list.append(empty);
  }
  for (const comment of comments) {
    const card = document.createElement("section"); card.className = "comment-card";
    const label = document.createElement("span"); label.className = "comment-label";
    label.textContent = comment.anchor.state === "attached" ? "ON THIS PASSAGE" : "UNANCHORED · PASSAGE CHANGED";
    const quote = document.createElement("button"); quote.className = "comment-quote"; quote.textContent = comment.anchor.quote;
    quote.disabled = comment.anchor.state === "orphaned";
    quote.onclick = () => { view.dispatch({ selection: { anchor: comment.anchor.from, head: comment.anchor.to }, scrollIntoView: true }); setMode("split"); view.focus(); };
    const body = document.createElement("p"); body.textContent = comment.body;
    const remove = document.createElement("button"); remove.className = "remove-comment"; remove.textContent = "Remove";
    remove.onclick = () => { if (!busy) view.dispatch({ effects: setComments.of(view.state.field(commentField).filter((c) => c.id !== comment.id)), annotations: isolateHistory.of("full") }); };
    card.append(label, quote, body, remove); list.append(card);
  }
}
function setMode(mode: string) {
  element("workspace").dataset.mode = mode;
  if (mode !== "write") updatePreview();
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => { if (button.tagName === "BUTTON") button.setAttribute("aria-pressed", String(button.dataset.mode === mode)); });
  if (mode !== "read") view.focus();
  else if (distractionFree) element<HTMLElement>("preview").parentElement!.focus();
}
for (const action of ["new", "open", "find", "save"] as const) element(action).onclick = () => { void perform(action); };
document.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((button) => { button.onclick = () => setMode(button.dataset.mode!); });
element("add-comment").onclick = beginComment;
element("comments-toggle").onclick = () => showComments(element("comments-panel").hidden);
element("comments-close").onclick = () => showComments(false);
element("dismiss-notice").onclick = () => { element("notice").hidden = true; };
element("dismiss-update").onclick = () => { void rpc.request.dismissUpdate(); };
element("cancel-comment").onclick = () => { pendingAnchor = null; element("comment-form").hidden = true; view.focus(); };
element("comment-form").onsubmit = (event) => {
  event.preventDefault();
  const body = element<HTMLTextAreaElement>("comment-body").value.trim();
  if (!pendingAnchor || !body || busy) return;
  if (generation !== pendingGeneration) { notice("The document changed while you wrote this comment. Select the passage again before adding it."); return; }
  const comment = { id: crypto.randomUUID(), body, createdAt: new Date().toISOString(), anchor: pendingAnchor };
  view.dispatch({ effects: setComments.of([...view.state.field(commentField), comment]), annotations: isolateHistory.of("full") });
  pendingAnchor = null; element("comment-form").hidden = true; view.focus();
};
element("save-copy").onclick = () => { void perform("saveAs"); };
element("reload").onclick = () => { void run(async () => {
  if (await canLeave()) applyDocument(await rpc.request.reload({ id: current.id }));
}); };
element("preview").onclick = (event) => {
  const link = (event.target as HTMLElement).closest("a"); if (!link) return;
  event.preventDefault(); const url = link.getAttribute("href");
  if (url && /^(https?:|mailto:)/i.test(url)) void rpc.request.openLink({ url }).catch((error) => notice(error.message));
};

setInterval(() => { void checkDisk(); }, 2000);
setInterval(() => {
  if (!settings.autoSave || !dirty || busy || !current || view.composing || hasCommentDraft()) return;
  void run(async () => {
    if (!dirty) return;
    if (current.path) await save();
    else if (settings.keepScratch) await persistScratch();
  });
}, 30_000);
async function checkDisk() {
  if (!current?.path || busy || checking || view.composing) return;
  checking = true;
  const id = current.id;
  try {
    const result = await rpc.request.check({ id });
    if (id !== current.id || busy) return;
    if (!result.changed) { element("conflict").hidden = true; return; }
    if (dirty || hasCommentDraft() || result.error) { element("conflict").hidden = false; if (result.error) notice(result.error); }
    else await run(async () => { applyDocument(await rpc.request.reload({ id })); notice("Reloaded changes made outside Sideleaf."); });
  } catch (error) { notice((error as Error).message); }
  finally { checking = false; }
}

async function initialize() {
  try {
    const initial = await rpc.request.initial({ restoreScratch: settings.keepScratch });
    applyDocument(initial.document, initial.recoveredScratch);
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
