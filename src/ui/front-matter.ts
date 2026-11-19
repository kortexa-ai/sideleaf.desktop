import { EditorState, Prec, RangeSet, StateField, Transaction, type StateEffect, type Text, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { codeFolding, foldEffect, foldedRanges, foldService, unfoldEffect } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

// A YAML front-matter block: `---` on line 1, a top-level `key:` line on line 2, and a closing `---` that ends inside
// the first 64 KiB (UTF-16 code units). Anything else stays ordinary Markdown.
export const FRONT_MATTER_LIMIT = 64 * 1024;
export interface FrontMatterField { key: string; value: string }
export interface FrontMatter { to: number; bodyFrom: number; raw: string; fields: FrontMatterField[] }
export interface FrontMatterGlance { items: FrontMatterField[]; text: string; count: string }
const FENCE = /^---[ \t]*$/;
const KEY_LINE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"\-[\]{}?!&*|>%@`,][^\r\n]*?)[ \t]*:(?:[ \t]|$)/;

export function detectFrontMatter(source: string): FrontMatter | null {
  if (!source.startsWith("---")) return null;
  const lines: string[] = [];
  for (let pos = 0, index = 0; ; index++) {
    const newline = source.indexOf("\n", pos), end = newline < 0 ? source.length : newline;
    if (end > FRONT_MATTER_LIMIT) return null;
    const text = source.slice(pos, end > pos && source.charCodeAt(end - 1) === 13 ? end - 1 : end);
    if (index === 0 ? !FENCE.test(text) : index === 1 && !KEY_LINE.test(text)) return null;
    if (index > 1 && FENCE.test(text)) {
      return { to: pos + text.length, bodyFrom: newline < 0 ? source.length : newline + 1, raw: lines.join("\n"), fields: readFrontMatterFields(lines) };
    }
    if (index > 0) lines.push(text);
    if (newline < 0) return null;
    pos = newline + 1;
  }
}
// The editor never turns a whole large document into one string for this.
export function frontMatterOf(doc: Text): FrontMatter | null {
  return doc.sliceString(0, 3) === "---" ? detectFrontMatter(doc.sliceString(0, FRONT_MATTER_LIMIT + 1)) : null;
}

const unquote = (text: string) => text.length > 1 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0] ? text.slice(1, -1) : text;
// A best-effort reader for display, not a YAML parser: unknown shapes keep their raw text.
export function readFrontMatterFields(lines: string[]): FrontMatterField[] {
  const fields: { key: string; rest: string; more: string[] }[] = [];
  for (const line of lines) {
    const match = KEY_LINE.exec(line);
    if (match) fields.push({ key: unquote(match[1]!), rest: line.slice(match[0].length).trim(), more: [] });
    else if (!line.startsWith("#")) fields.at(-1)?.more.push(line);
  }
  return fields.map(({ key, rest, more }) => {
    while (more.length && !more.at(-1)!.trim()) more.pop();
    const indent = Math.min(...more.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)![0].length));
    const lines = more.map((line) => line.trim() ? line.slice(indent) : "");
    if (/^[|>][1-9+-]*$/.test(rest)) {
      if (rest[0] === "|") return { key, value: lines.join("\n") };
      // Folded: lines join with spaces, and each blank line becomes one line break.
      return { key, value: lines.reduce((value, line) => !line ? `${value}\n` : !value || value.endsWith("\n") ? value + line : `${value} ${line}`, "") };
    }
    return { key, value: !lines.length ? unquote(rest) : (rest ? [rest, ...lines] : lines).join("\n") };
  });
}

const GLANCE_ORDER = ["title", "name", "type", "status", "date", "tags", "description"];
const isOpaque = ({ key, value }: FrontMatterField) => /^(?:id|uuid)$/i.test(key)
  || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  || /^[0-9a-f]{16,}$/i.test(value) || /^[A-Za-z0-9+/=_-]{20,}$/.test(value) && /\d/.test(value) && !/[a-z]{4,}/.test(value);
function clip(text: string, limit: number) {
  if (text.length <= limit) return text;
  const cut = /[\uDC00-\uDFFF]/.test(text[limit - 1]!) ? limit - 2 : limit - 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}
function oneLine(value: string) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length && lines.every((line) => line === "-" || line.startsWith("- "))
    ? lines.map((line) => line.slice(2).trim()).join(", ") : value.replace(/\s+/g, " ").trim();
}
// The closed one-line view: useful keys first, identifiers last, every value on one clipped line, `limit` characters in all.
export function frontMatterGlance(fields: FrontMatterField[], limit = 160): FrontMatterGlance {
  const rank = (field: FrontMatterField, index: number) => isOpaque(field) ? [2, index]
    : GLANCE_ORDER.includes(field.key.toLowerCase()) ? [0, GLANCE_ORDER.indexOf(field.key.toLowerCase())] : [1, index];
  const ordered = fields.map((field, index) => ({ field, rank: rank(field, index) }))
    .sort((a, b) => a.rank[0]! - b.rank[0]! || a.rank[1]! - b.rank[1]!).map(({ field }) => field);
  const items: FrontMatterField[] = [];
  let used = 0;
  for (const field of ordered) {
    const room = limit - used - (items.length ? 3 : 0) - field.key.length - 1;
    if (room < 2) break;
    const value = clip(clip(oneLine(field.value), isOpaque(field) ? 9 : 60), room);
    items.push({ key: field.key, value });
    used += (items.length > 1 ? 3 : 0) + field.key.length + (value ? value.length + 1 : 0);
  }
  return { items, text: items.map(({ key, value }) => value ? `${key} ${value}` : key).join(" · "), count: `${fields.length} ${fields.length === 1 ? "field" : "fields"}` };
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const escapeHTML = (text: string) => text.replace(/[&<>"]/g, (character) => ENTITIES[character]!);
// One markup for the preview summary and the editor placeholder, so both panes read as the same thing.
export function frontMatterLineHTML(glance: FrontMatterGlance): string {
  const items = glance.items.map(({ key, value }) => `<span class="front-matter-key">${escapeHTML(key)}</span>${value ? ` ${escapeHTML(value)}` : ""}`);
  return `<span class="front-matter-chevron" aria-hidden="true">›</span><span class="front-matter-label">Front matter</span>`
    + `<span class="front-matter-glance">${items.join('<span class="front-matter-dot"> · </span>')}</span><span class="front-matter-count">${glance.count}</span>`;
}

// Write pane. The node replaces the paragraph, setext heading and horizontal rule that CommonMark sees in the block.
export const frontMatterSyntax: MarkdownConfig = {
  defineNodes: [{ name: "FrontMatter", block: true, style: tags.meta }],
  parseBlock: [{
    name: "FrontMatter",
    before: "HorizontalRule",
    parse(cx, line) {
      if (cx.lineStart !== 0 || !FENCE.test(line.text) || !KEY_LINE.test(cx.peekLine())) return false;
      // Without a closing line the block runs to the end of the document, as in VS Code. Looking further ahead
      // than the next line would read outside the parse context and break incremental re-parsing.
      while (cx.nextLine()) if (FENCE.test(line.text)) { cx.nextLine(); break; }
      cx.addElement(cx.elt("FrontMatter", 0, cx.prevLineEnd()));
      return true;
    },
  }],
};

export const frontMatterField = StateField.define<FrontMatter | null>({
  create: (state) => frontMatterOf(state.doc),
  update(value, tr) {
    if (!tr.docChanged) return value;
    let touched = false;
    tr.changes.iterChangedRanges((fromA) => { if (fromA <= (value ? value.to : FRONT_MATTER_LIMIT)) touched = true; });
    return touched ? frontMatterOf(tr.newDoc) : value;
  },
});
export function isFrontMatterFolded(state: EditorState): boolean {
  const matter = state.field(frontMatterField, false);
  let folded = false;
  if (matter) foldedRanges(state).between(0, 0, (from, to) => { if (from === 0 && to === matter.to) folded = true; });
  return folded;
}
export function setFrontMatterFolded(target: { state: EditorState; dispatch: (spec: TransactionSpec) => void }, folded: boolean): boolean {
  const matter = target.state.field(frontMatterField, false);
  if (!matter || isFrontMatterFolded(target.state) === folded) return false;
  target.dispatch({ effects: (folded ? foldEffect : unfoldEffect).of({ from: 0, to: matter.to }) });
  return true;
}
// A document opens with its front matter closed and the caret at the start of the body.
export function withFrontMatterFolded(state: EditorState): EditorState {
  const matter = state.field(frontMatterField, false);
  return !matter ? state : state.update({ effects: foldEffect.of({ from: 0, to: matter.to }), selection: { anchor: matter.bodyFrom }, annotations: Transaction.addToHistory.of(false) }).state;
}
// Plain text has no front-matter placeholder, so a switch to it opens the block first.
export function frontMatterUnfoldEffects(state: EditorState): StateEffect<unknown>[] {
  return isFrontMatterFolded(state) ? [unfoldEffect.of({ from: 0, to: state.field(frontMatterField)!.to })] : [];
}

const atomicBlock = Decoration.replace({});
function placeholder(view: EditorView, onclick: (event: Event) => void, glance: FrontMatterGlance | null): HTMLElement {
  const element = document.createElement("span");
  if (glance) {
    element.className = "cm-frontMatter front-matter-line";
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `Front matter, ${glance.count}. Show`);
    element.title = `Show front matter: ${glance.text}`;
    element.innerHTML = frontMatterLineHTML(glance);
  } else {
    // Every other fold keeps CodeMirror's own placeholder.
    element.textContent = "…";
    element.setAttribute("aria-label", view.state.phrase("folded code"));
    element.title = view.state.phrase("unfold");
    element.className = "cm-foldPlaceholder";
  }
  element.onclick = onclick;
  return element;
}
export const frontMatterEditor = [
  frontMatterField,
  Prec.high(foldService.of((state, from) => {
    const matter = from === 0 ? state.field(frontMatterField, false) : null;
    return matter ? { from: 0, to: matter.to } : null;
  })),
  codeFolding({
    preparePlaceholder: (state, range) => {
      const matter = state.field(frontMatterField, false);
      return matter && range.from === 0 && range.to === matter.to ? frontMatterGlance(matter.fields) : null;
    },
    placeholderDOM: placeholder,
  }),
  // A change that starts in the closed block opens it, so a stale glance never shows. An extender, not a filter,
  // so that undo and redo, which skip filters, also open it. The fold's start maps forward and its end backward,
  // like the replace decoration that draws it.
  EditorState.transactionExtender.of((tr) => {
    const matter = tr.startState.field(frontMatterField, false);
    let touched = false;
    if (matter && tr.docChanged) tr.changes.iterChangedRanges((fromA) => { if (fromA <= matter.to) touched = true; });
    return touched && isFrontMatterFolded(tr.startState) ? { effects: unfoldEffect.of({ from: tr.changes.mapPos(0, 1), to: tr.changes.mapPos(matter!.to, -1) }) } : null;
  }),
  // The stock fold key folds only a range that starts on the caret's line. This one also closes the block from inside it.
  Prec.high(keymap.of([{ key: "Ctrl-Shift-[", mac: "Cmd-Alt-[", run: (view) => {
    const matter = view.state.field(frontMatterField, false), head = view.state.selection.main.head;
    return !!matter && head <= matter.to && setFrontMatterFolded(view, true);
  } }])),
  // The closed block is one step for the caret. CodeMirror's own folds are not.
  EditorView.atomicRanges.of((view) => isFrontMatterFolded(view.state) ? RangeSet.of(atomicBlock.range(0, view.state.field(frontMatterField)!.to)) : RangeSet.empty),
  EditorState.transactionFilter.of((tr) => {
    const matter = tr.startState.field(frontMatterField, false), head = tr.newSelection.main.head;
    if (!matter) return tr;
    // Being one step, the block would go whole with one Backspace or Delete beside it. That key opens it instead.
    if (tr.isUserEvent("delete") && tr.startState.selection.ranges.every((range) => range.empty) && isFrontMatterFolded(tr.startState)) {
      let whole = false;
      tr.changes.iterChangedRanges((fromA, toA) => { if (fromA === 0 && toA >= matter.to) whole = true; });
      if (whole) return { effects: unfoldEffect.of({ from: 0, to: matter.to }) };
    }
    // Closing the block with the caret inside it moves the caret to the body instead of hiding it.
    return !tr.docChanged && head > 0 && head < matter.to && tr.effects.some((effect) => effect.is(foldEffect) && effect.value.from === 0 && effect.value.to === matter.to)
      ? [tr, { selection: { anchor: matter.bodyFrom }, sequential: true }] : tr;
  }),
];
