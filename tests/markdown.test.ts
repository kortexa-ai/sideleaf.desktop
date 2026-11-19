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

test("front matter renders as one closed block with escaped fields, not a rule and a heading", () => {
  const note = renderMarkdown("---\ntype: note\ncreated: 2026-11-17T23:42:13Z\ntitle: Tom & Jerry <script>alert(1)</script>\nid: 0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d\n---\n\n# Body\n\nText.\n");
  assert.ok(note.startsWith('<details class="front-matter"><summary class="front-matter-line">'));
  assert.doesNotMatch(note, /<hr|<h2|<script/);
  assert.equal(note.match(/data-heading-id/g)!.length, 1);
  assert.match(note, /<span class="front-matter-count">4 fields<\/span>/);
  assert.match(note, /<dt>title<\/dt><dd>Tom &amp; Jerry &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/dd>/);
  assert.match(note, /<\/details>\n<h1 id="sideleaf-heading-body" data-heading-id="body">Body<\/h1>/);
  assert.match(renderMarkdown("---\ntitle: x\n---", { frontMatterOpen: true }), /^<details class="front-matter" open>/);
  const skill = renderMarkdown(`---\nname: pdf-forms\ndescription: ${"Fill & check forms. ".repeat(30)}\nmetadata:\n  version: 2\n---\n`);
  assert.match(skill, /<dt>metadata<\/dt><dd>version: 2<\/dd><\/dl><\/details>\n$/);
  assert.match(skill, /<span class="front-matter-key">name<\/span> pdf-forms/);
});

test("text that only looks like front matter renders as before, and a later --- stays a rule", () => {
  for (const source of ["---\n# Title\n---\n", "---\ntitle: x\nno closing\n", "\n---\ntitle: x\n---\n", "Intro\n\n---\ntitle: x\n---\n", "> ---\n> title: x\n> ---\n"]) {
    assert.doesNotMatch(renderMarkdown(source), /front-matter/, source);
  }
  assert.equal(renderMarkdown("---\n# Title\n---\n"), "<hr>\n<h1 id=\"sideleaf-heading-title\" data-heading-id=\"title\">Title</h1>\n<hr>\n");
  assert.match(renderMarkdown("---\ntitle: x\n---\n\nA\n\n---\n\nB\n"), /<\/details>\n<p>A<\/p>\n<hr>\n<p>B<\/p>/);
});

test("TOML and ...-closed blocks render like --- blocks, with the block's length and long values' own length", () => {
  const toml = renderMarkdown('+++\ntitle = "Notes & more"\n[extra]\nmood = "calm"\n+++\n\n# Body\n');
  assert.ok(toml.startsWith('<details class="front-matter"><summary class="front-matter-line">'));
  assert.doesNotMatch(toml, /<p>\+\+\+|<hr/);
  assert.match(toml, /<dt>title<\/dt><dd>Notes &amp; more<\/dd><dt>extra<\/dt><dd>mood = &quot;calm&quot;<\/dd>/);
  assert.match(toml, /2 fields<\/span><span class="front-matter-size"><span class="front-matter-dot"> · <\/span>44 characters<\/span><\/summary>/);
  const dots = renderMarkdown("---\ntitle: x\n...\n\nText\n");
  assert.match(dots, /<\/details>\n<p>Text<\/p>/);
  assert.doesNotMatch(dots, /<h2|<hr|\.\.\./);
  const long = renderMarkdown(`---\nshort: ${"a".repeat(200)}\nlong: ${"🌿".repeat(587)}\n---\n`);
  assert.match(long, new RegExp(`<dd>${"a".repeat(200)}</dd>`));
  assert.match(long, /🌿<span class="front-matter-length">587 characters<\/span><\/dd>/);
  assert.match(renderMarkdown(`---\nlong: ${"b".repeat(1234)}\n---\n`), /<span class="front-matter-length">1,234 characters<\/span>/);
  assert.equal(renderMarkdown("+++\ntitle: x\n+++\n"), "<p>+++\ntitle: x\n+++</p>\n");
});
