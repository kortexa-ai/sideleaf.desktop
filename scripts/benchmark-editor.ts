import { EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { commentField, commentHistory } from "../src/ui/comments.ts";
import { wordCountField } from "../src/ui/word-count.ts";
import { PREVIEW_LIMIT, renderMarkdown } from "../src/ui/markdown.ts";

// Measures editor-state transactions and preview parsing, not native key-to-paint
// latency. Run on both hosts with `npm run bench:editor`; times vary with the CPU.
const paragraph = "# Heading\n\nOne green leaf beside these words.\n\n";
const results = [];
for (const bytes of [700_000, 9_000_000]) {
  const text = paragraph.repeat(Math.ceil(bytes / paragraph.length)).slice(0, bytes);
  let state = EditorState.create({ doc: text, extensions: [history(), commentField, commentHistory, wordCountField] });
  const timings = [];
  for (let i = 0; i < 60; i++) {
    const start = performance.now();
    state = state.update({ changes: { from: 0, insert: "x" } }).state;
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const start = performance.now();
  renderMarkdown(state.doc.sliceString(0, PREVIEW_LIMIT));
  const words = state.field(wordCountField);
  const previewAndWordCountMs = performance.now() - start;
  if (words !== (state.doc.toString().match(/\S+/g)?.length ?? 0)) throw new Error("Word count mismatch");
  results.push({ bytes, typingMedianMs: timings[30], typingP95Ms: timings[57], previewAndWordCountMs, words });
}
console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version, results }, null, 2));
