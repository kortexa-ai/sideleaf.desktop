import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { invertedEffects } from "@codemirror/commands";
import { makeAnchor } from "../document/anchors.ts";
import type { Comment } from "../shared/contracts.ts";

export const setComments = StateEffect.define<Comment[]>();
export const commentField = StateField.define<Comment[]>({
  create: () => [],
  update(comments, transaction) {
    let next = comments;
    if (transaction.docChanged) {
      const text = transaction.newDoc.toString();
      next = comments.map((comment) => {
        const anchor = comment.anchor;
        if (anchor.state === "orphaned") return comment;
        let touched = false;
        transaction.changes.iterChanges((from, to) => {
          if ((from < anchor.to && to > anchor.from) || (from === to && from > anchor.from && from < anchor.to)) touched = true;
        });
        const from = transaction.changes.mapPos(anchor.from, 1);
        const to = transaction.changes.mapPos(anchor.to, -1);
        if (touched || to <= from || text.slice(from, to) !== anchor.quote) return { ...comment, anchor: { ...anchor, state: "orphaned" as const } };
        return { ...comment, anchor: makeAnchor(text, from, to) };
      });
    }
    for (const effect of transaction.effects) if (effect.is(setComments)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (comments) => Decoration.set(comments
    .filter((c) => c.anchor.state === "attached")
    .map((c) => Decoration.mark({ class: "comment-anchor", attributes: { title: c.body } }).range(c.anchor.from, c.anchor.to)), true)),
});

// Restoring the exact prior annotation set makes undo of deletions and comment
// creation predictable. Comments participate in the editor's single history.
export const commentHistory = invertedEffects.of((transaction) =>
  transaction.docChanged || transaction.effects.some((e) => e.is(setComments))
    ? [setComments.of(transaction.startState.field(commentField))] : []);
