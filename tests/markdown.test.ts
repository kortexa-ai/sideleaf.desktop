import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown, setHardBreaks } from "../src/ui/markdown.ts";

test("single line breaks are spaces by default and line breaks when enabled", () => {
  setHardBreaks(false);
  assert.doesNotMatch(renderMarkdown("a\nb"), /<br/);
  setHardBreaks(true);
  assert.match(renderMarkdown("a\nb"), /<br/);
  // Paragraph breaks must never become hard breaks.
  assert.doesNotMatch(renderMarkdown("a\n\nb"), /<br/);
  setHardBreaks(false);
});
