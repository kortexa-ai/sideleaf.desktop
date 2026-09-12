import { ChangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { invertedEffects } from "@codemirror/commands";
import type { ReviewThread } from "../shared/contracts.ts";

export const setComments = StateEffect.define<ReviewThread[]>();
export const setAgentHighlights = StateEffect.define<{ from: number; to: number }[]>();
export function composeAgentChanges(length: number, edits: { operation: number; from: number; to: number; text: string }[]) {
  let changes = ChangeSet.empty(length), documentLength = length;
  const highlights = new Map<number, { from: number; to: number }>();
  for (const edit of edits) {
    const step = ChangeSet.of({ from: edit.from, to: edit.to, insert: edit.text }, documentLength);
    for (const [operation, range] of highlights) {
      const touched = edit.from < range.to && edit.to > range.from || edit.from === edit.to && edit.from > range.from && edit.from < range.to;
      if (touched) highlights.delete(operation);
      else highlights.set(operation, { from: step.mapPos(range.from, 1), to: step.mapPos(range.to, -1) });
    }
    highlights.set(edit.operation, { from: edit.from, to: edit.from + edit.text.length });
    changes = changes.compose(step); documentLength += edit.text.length - (edit.to - edit.from);
  }
  return { changes, highlights: [...highlights.values()], byOperation: highlights };
}
export const agentHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlights, transaction) {
    let next = highlights.map(transaction.changes);
    if (transaction.docChanged && !transaction.isUserEvent("input.agent")) next = Decoration.none;
    for (const effect of transaction.effects) if (effect.is(setAgentHighlights)) {
      next = Decoration.set(effect.value.filter((range) => range.to > range.from)
        .map((range) => Decoration.mark({ class: "agent-applied", attributes: { title: "Applied by an agent in this session" } }).range(range.from, range.to)), true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
export const commentField = StateField.define<ReviewThread[]>({
  create: () => [],
  update(comments, transaction) {
    let next = comments;
    if (transaction.docChanged && comments.length) {
      const text = transaction.newDoc;
      next = comments.map((comment) => {
        const anchor = comment.anchor;
        if (anchor.state === "orphaned") return comment;
        let touched = false;
        transaction.changes.iterChanges((from, to) => {
          if ((from < anchor.to && to > anchor.from) || (from === to && from > anchor.from && from < anchor.to)) touched = true;
        });
        const from = transaction.changes.mapPos(anchor.from, 1);
        const to = transaction.changes.mapPos(anchor.to, -1);
        if (touched || to <= from || text.sliceString(from, to) !== anchor.quote) return { ...comment, anchor: { ...anchor, state: "orphaned" as const } };
        const prefix = text.sliceString(Math.max(0, from - 32), from);
        const suffix = text.sliceString(to, Math.min(text.length, to + 32));
        if (from === anchor.from && to === anchor.to && prefix === anchor.prefix && suffix === anchor.suffix) return comment;
        return { ...comment, anchor: { ...anchor, from, to, prefix, suffix } };
      });
      if (next.every((comment, index) => comment === comments[index])) next = comments;
    }
    for (const effect of transaction.effects) if (effect.is(setComments)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (comments) => Decoration.set(comments
    .filter((c) => c.anchor.state === "attached")
    .map((c) => Decoration.mark({ class: "comment-anchor", attributes: { title: c.messages[0]?.body ?? "Review thread" } }).range(c.anchor.from, c.anchor.to)), true)),
});

// Restoring the exact prior annotation set makes undo of deletions and comment
// creation predictable. Comments participate in the editor's single history.
export const commentHistory = invertedEffects.of((transaction) =>
  transaction.docChanged || transaction.effects.some((e) => e.is(setComments))
    ? [setComments.of(transaction.startState.field(commentField))] : []);
