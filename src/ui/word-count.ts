import { StateField, type Text } from "@codemirror/state";

function starts(text: string, continuesWord: boolean): number {
  const words = /\S+/g;
  let count = 0;
  for (let match = words.exec(text); match; match = words.exec(text)) {
    if (match.index !== 0 || !continuesWord) count++;
  }
  return count;
}

function inRange(doc: Text, from: number, to: number): number {
  return starts(doc.sliceString(from, to), from > 0 && /\S/.test(doc.sliceString(from - 1, from)));
}

// A word starts at a non-space character after whitespace or the start of the
// document. An edit changes starts only inside its span and at its right edge.
// Count that edge too, so joining/splitting words and deleting newlines work.
export const wordCountField = StateField.define<number>({
  create(state) { return inRange(state.doc, 0, state.doc.length); },
  update(count, transaction) {
    if (!transaction.docChanged) return count;
    transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
      count -= inRange(transaction.startState.doc, fromA, Math.min(transaction.startState.doc.length, toA + 1));
      count += inRange(transaction.newDoc, fromB, Math.min(transaction.newDoc.length, toB + 1));
    });
    return count;
  },
});
