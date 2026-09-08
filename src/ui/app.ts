import "./app.css";
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
import { makeAnchor } from "../document/anchors.ts";
import { documentMetadata, type Anchor, type Command, type DocumentMetadata, type DocumentSnapshot, type Draft, type SideleafRPC } from "../shared/contracts.ts";

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const readonly = new Compartment();
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

const rpc = Electroview.defineRPC<SideleafRPC>({
  maxRequestTime: 120_000,
  handlers: { messages: { command: (command) => { void perform(command); } } },
});
// With the pinned Windows runtime the loopback socket opens but does not deliver
// renderer requests. Use the SDK's native IPC transport on that platform.
class SideleafView extends Electroview<typeof rpc> {
  override initSocketToHost() {
    if (window.__electrobunPlatform !== "windows") super.initSocketToHost();
  }
}
new SideleafView({ rpc });
rpc.send.diagnostic({ event: "editor-starting", message: "Native bridge attached" });

const view = new EditorView({ parent: element("editor"), state: createEditorState("") });
rpc.send.diagnostic({ event: "editor-created", message: "CodeMirror initialized" });

function createEditorState(text: string, comments: Draft["comments"] = []) {
  return EditorState.create({
    doc: text,
    extensions: [
      Prec.highest(keymap.of([{ key: "Mod-Shift-m", run: () => { beginComment(); return true; } }])),
      basicSetup, markdown(), commentField.init(() => comments), commentHistory, wordCountField,
      readonly.of(EditorState.readOnly.of(false)), EditorView.lineWrapping,
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
        ".cm-gutters": { background: "var(--paper)", color: "var(--faint)", border: "none", paddingTop: "24px" },
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
  element("unsaved").hidden = !dirty;
  element("status").textContent = busy ? "Working…" : dirty ? "Unsaved changes" : current.path ? "Saved locally" : "Ready to write";
}
function applyDocument(snapshot: DocumentSnapshot) {
  current = documentMetadata(snapshot);
  view.setState(createEditorState(snapshot.text, snapshot.comments));
  savedDoc = view.state.doc; savedComments = commentsJSON(); dirty = false; generation++;
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
function updateSelection() {
  const selection = view.state.selection.main;
  element<HTMLButtonElement>("add-comment").disabled = selection.empty || busy;
  const line = view.state.doc.lineAt(selection.head);
  element("selection-status").textContent = selection.empty ? `Ln ${line.number}, Col ${selection.head - line.from + 1}` : `${selection.to - selection.from} selected`;
}
function updatePreview() {
  if (!previewDirty || element("workspace").dataset.mode === "write") return;
  const source = view.state.doc.sliceString(0, PREVIEW_LIMIT);
  element("preview").innerHTML = source.trim() ? renderMarkdown(source) : '<div class="empty-reader"><span class="empty-leaf">❧</span><h1>Make yourself a little space.</h1><p>Your words will take shape here.<br>Write on the left, or open a Markdown file.</p></div>';
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
async function save(saveAs = false): Promise<boolean> {
  const result = await rpc.request.save({ id: current.id, draft: draft(), saveAs });
  if (!result) return false;
  current = result; savedDoc = view.state.doc; savedComments = commentsJSON();
  element("conflict").hidden = true; element("notice").hidden = true;
  refreshDocumentName(); updateDirty(); return true;
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
  const choice = await rpc.request.confirmDiscard();
  return choice === "save" ? save() : choice === "discard";
}
async function run(operation: () => Promise<void>) {
  if (busy || !current) return;
  if (view.composing) { notice("Finish entering your current character before opening or saving a file."); return; }
  busy = true; view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
  updateDirty(); updateSelection();
  try { await operation(); }
  catch (error) { notice((error as Error).message || String(error)); }
  finally { busy = false; view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(false)) }); updateDirty(); updateSelection(); }
}
async function perform(command: Command) {
  if (busy || !current) return;
  if (command === "comment") { beginComment(); return; }
  if (command === "find") { openSearchPanel(view); return; }
  if (command === "undo" || command === "redo") { (command === "undo" ? undo : redo)(view); view.focus(); return; }
  await run(async () => {
    if (command === "save" || command === "saveAs") { await save(command === "saveAs"); return; }
    if (!(await canLeave())) return;
    if (command === "open") { const next = await rpc.request.open(); if (next) applyDocument(next); }
    else if (command === "new") applyDocument(await rpc.request.newDocument());
    else await rpc.request.finishClose({ quit: command === "quit" });
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
  const { from, to } = view.state.selection.main;
  try { pendingAnchor = makeAnchor(view.state.doc.toString(), from, to); }
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
}
for (const action of ["new", "open", "save"] as const) element(action).onclick = () => { void perform(action); };
document.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((button) => { button.onclick = () => setMode(button.dataset.mode!); });
element("add-comment").onclick = beginComment;
element("comments-toggle").onclick = () => showComments(element("comments-panel").hidden);
element("comments-close").onclick = () => showComments(false);
element("dismiss-notice").onclick = () => { element("notice").hidden = true; };
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
    applyDocument(await rpc.request.initial());
    rpc.send.ready({ userAgent: navigator.userAgent });
  } catch (error) {
    const message = `Sideleaf could not start: ${(error as Error).message}`;
    notice(message);
    rpc.send.diagnostic({ event: "editor-failed", message });
  }
}
void initialize();
