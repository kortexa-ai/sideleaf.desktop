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

test("bare <br> tags break lines, including in table cells, while other HTML stays escaped", () => {
  const table = renderMarkdown("| Repositories |\n| --- |\n| a<br>b<br/>c<BR />d |\n");
  assert.match(table, /<td>a<br>\nb<br>\nc<br>\nd<\/td>/);
  assert.match(renderMarkdown("one<br>two"), /one<br>\ntwo/);
  const escaped = renderMarkdown("<b>x</b> <br class=\"x\"> <script>alert(1)</script> `<br>`");
  assert.match(escaped, /&lt;b&gt;x&lt;\/b&gt; &lt;br class=&quot;x&quot;&gt; &lt;script&gt;/);
  assert.match(escaped, /<code>&lt;br&gt;<\/code>/);
});
