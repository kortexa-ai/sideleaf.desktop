import { EditorSelection, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import type { StateCommand } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";

type Span = { from: number; to: number };
type Emphasis = Span & { marks: Span[] };
const protectedNodes = new Set(["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "Autolink", "Image", "URL", "LinkTitle", "LinkMark", "ListMark", "QuoteMark", "HeaderMark"]);

function subtract(spans: Span[], blocked: Span): Span[] {
  return spans.flatMap((span) => blocked.to <= span.from || blocked.from >= span.to ? [span] : [
    ...(blocked.from > span.from ? [{ from: span.from, to: blocked.from }] : []),
    ...(blocked.to < span.to ? [{ from: blocked.to, to: span.to }] : []),
  ]);
}

/** Toggle Markdown emphasis without rewriting code, destinations or block markers. */
export function toggleEmphasis(marker: "*" | "**"): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return true;
    const end = Math.max(...state.selection.ranges.map((range) => range.to));
    const tree = ensureSyntaxTree(state, end, 100);
    // A plain-text editor has no Markdown tree. Never insert formatting there.
    if (!tree || tree.type.name !== "Document") return true;
    const name = marker === "**" ? "StrongEmphasis" : "Emphasis";
    const protectedSpans: Span[] = [], emphasis: Emphasis[] = [];
    tree.iterate({ from: Math.min(...state.selection.ranges.map((range) => range.from)), to: end, enter(node) {
      if (protectedNodes.has(node.name)) {
        let to = node.to;
        if (node.name === "ListMark") {
          const task = /^[ \t]+\[[ xX]\](?=[ \t])/.exec(state.sliceDoc(to, state.doc.lineAt(to).to));
          if (task) to += task[0].length;
        }
        protectedSpans.push({ from: node.from, to }); return false;
      }
      if (node.name === name) {
        const marks: Span[] = [];
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === "EmphasisMark") marks.push({ from: child.from, to: child.to });
        }
        if (marks.length === 2) emphasis.push({ from: node.from, to: node.to, marks });
      }
    } });
    const edits: { from: number; to: number; insert: string }[] = [];
    const emptyInsertions = new Set<number>();
    const add = (from: number, to: number, insert = "") => edits.push({ from, to, insert });
    const remove = (node: Emphasis) => node.marks.forEach((mark) => add(mark.from, mark.to));
    for (const range of state.selection.ranges) {
      if (range.empty) {
        const pos = range.head;
        if (protectedSpans.some((span) => pos > span.from && pos < span.to)) continue;
        const enclosing = emphasis.filter((node) => pos >= node.marks[0]!.to && pos <= node.marks[1]!.from).at(-1);
        if (enclosing) { remove(enclosing); continue; }
        // Empty delimiter pairs have no emphasis syntax node until text is typed.
        if (state.sliceDoc(Math.max(0, pos - marker.length), pos) === marker && state.sliceDoc(pos, pos + marker.length) === marker) {
          add(pos - marker.length, pos + marker.length); continue;
        }
        add(pos, pos, marker + marker); emptyInsertions.add(pos); continue;
      }
      let spans: Span[] = [];
      for (let line = state.doc.lineAt(range.from); ; line = state.doc.line(line.number + 1)) {
        spans.push({ from: Math.max(range.from, line.from), to: Math.min(range.to, line.to) });
        if (line.to >= range.to) break;
      }
      for (const blocked of protectedSpans) spans = subtract(spans, blocked);
      for (const span of spans) {
        const text = state.sliceDoc(span.from, span.to), leading = text.length - text.trimStart().length;
        const from = span.from + leading, to = span.to - (text.length - text.trimEnd().length);
        if (from >= to) continue;
        const enclosing = emphasis.filter((node) => from >= node.from && to <= node.to).at(-1);
        if (enclosing) {
          const includesContent = from < enclosing.marks[1]!.from && to > enclosing.marks[0]!.to;
          if (includesContent) remove(enclosing);
          continue;
        }
        const contained = emphasis.filter((node) => node.from >= from && node.to <= to);
        // A partially selected delimiter is not safe to rewrite. Expand such a
        // selection explicitly before toggling it, rather than corrupt Markdown.
        if (emphasis.some((node) => node.from < to && node.to > from && !contained.includes(node))) continue;
        contained.forEach(remove);
        add(from, from, marker); add(to, to, marker);
      }
    }
    if (!edits.length) return true;
    const unique = [...new Map(edits.map((edit) => [`${edit.from}:${edit.to}:${edit.insert}`, edit])).values()]
      .sort((a, b) => a.from - b.from || a.to - b.to);
    // Selections can share an enclosing emphasis node. Deduplicate its markers
    // and combine insertions/removals at each boundary into one transaction.
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const edit of unique) {
      const previous = changes.at(-1);
      if (previous && edit.from < previous.to && edit.from !== previous.from) return true;
      if (previous && edit.from === previous.from) { previous.to = Math.max(previous.to, edit.to); previous.insert += edit.insert; }
      else changes.push({ ...edit });
    }
    const changeSet = state.changes(changes);
    const ranges = state.selection.ranges.map((range) => {
      if (range.empty) return EditorSelection.cursor(changeSet.mapPos(range.head, -1) + (emptyInsertions.has(range.head) ? marker.length : 0));
      const from = changeSet.mapPos(range.from, 1), to = changeSet.mapPos(range.to, -1);
      return range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
    });
    dispatch(state.update({ changes: changeSet, selection: EditorSelection.create(ranges, state.selection.mainIndex),
      userEvent: "input.format", annotations: isolateHistory.of("full"), scrollIntoView: true }));
    return true;
  };
}

export const toggleBold = toggleEmphasis("**");
export const toggleItalic = toggleEmphasis("*");

// basicSetup binds Mod-i to selectParentSyntax. Our formatting bindings must
// precede it, including when selected text already sits inside emphasis.
export function formattingShortcuts(canEdit: () => boolean) {
  return Prec.high(keymap.of([
    { key: "Mod-b", run: (view) => canEdit() && toggleBold(view) },
    { key: "Mod-i", run: (view) => canEdit() && toggleItalic(view) },
  ]));
}
