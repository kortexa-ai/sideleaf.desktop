import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown, setHardBreaks } from "../src/ui/markdown.ts";

test("relative links render without enabling unsafe schemes or raw HTML", () => {
  const html = renderMarkdown("[Guide](docs/DEVELOP.md) [Parent](../README.md#read-me) [Space](<notes café.md>) [Here](#read-me)");
  assert.match(html, /href="docs\/DEVELOP.md"/);
  assert.match(html, /href="\.\.\/README.md#read-me"/);
  assert.match(html, /href="notes%20caf%C3%A9.md"/);
  assert.match(html, /href="#read-me"/);
  for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/a.md", "views://main/index.html", "//evil.example/a", "/tmp/a.md"]) {
    assert.doesNotMatch(renderMarkdown(`[No](${url})`), /<a /);
  }
});

test("heading fragments use visible text, Unicode and unique stable IDs", () => {
  const source = "# Read *me*\n# Read me\n# Read me-1\n# Café 葉\n# Read me\n";
  const first = renderMarkdown(source);
  assert.match(first, /data-heading-id="read-me"/);
  assert.match(first, /data-heading-id="read-me-1"/);
  assert.match(first, /data-heading-id="read-me-1-1"/);
  assert.match(first, /data-heading-id="café-葉"/);
  assert.match(first, /data-heading-id="read-me-2"/);
  assert.equal(renderMarkdown(source), first);
});

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
