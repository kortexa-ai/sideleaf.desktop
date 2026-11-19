import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFrontMatter, FRONT_MATTER_LIMIT, frontMatterGlance, frontMatterLineHTML, readFrontMatterFields, readTomlFields } from "../src/ui/front-matter.ts";

const note = "---\ntype: note\ncreated: 2026-11-17T23:42:13Z\nupdated: 2026-11-17T23:42:13Z\nid: 0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d\n---\n\nA quiet note.\n";

test("front matter starts on line 1, has a key on line 2 and closes with ---", () => {
  const matter = detectFrontMatter(note)!;
  assert.equal(note.slice(0, matter.to).split("\n").at(-1), "---");
  assert.equal(matter.bodyFrom, matter.to + 1);
  assert.equal(note.slice(matter.bodyFrom), "\nA quiet note.\n");
  assert.equal(matter.raw.split("\n").length, 4);
  assert.deepEqual(matter.fields.map((field) => field.key), ["type", "created", "updated", "id"]);
  // Trailing spaces and tabs on the markers, CRLF, and a block with no body.
  assert.ok(detectFrontMatter("--- \t\ntitle: x\n---\t \nbody"));
  const crlf = detectFrontMatter("---\r\ntitle: x\r\n---\r\nbody")!;
  assert.deepEqual([crlf.to, crlf.bodyFrom, crlf.fields], [18, 20, [{ key: "title", value: "x" }]]);
  const only = detectFrontMatter("---\ntitle: x\n---")!;
  assert.deepEqual([only.to, only.bodyFrom], [16, 16]);
  for (const key of ["description:", "allowed-tools: [a, b]", '"quoted key": 1', "'single': 2", "a:b: c"]) assert.ok(detectFrontMatter(`---\n${key}\n---\n`), key);
});

test("anything else is not front matter", () => {
  for (const source of [
    "---\ntitle: x\nno closing line\n",
    "---\n\ntitle: x\n---\n",
    "---\n# Title\n---\n",
    "---\nplain prose without a key\n---\n",
    "---\ntitle:x\n---\n",
    "---\n- item: x\n---\n",
    "\n---\ntitle: x\n---\n",
    " ---\ntitle: x\n---\n",
    "Text\n---\ntitle: x\n---\n",
    "+++\ntitle: x\n+++\n",
    "---\ntitle = \"x\"\n---\n",
    "+++\n\ntitle = 1\n+++\n",
    "+++\n# comment\ntitle = 1\n+++\n",
    "+++\ntitle = 1\n---\n",
    "+++\ntitle = 1\n...\n",
    "+++\ntitle = 1\nno closing\n",
    "++++\ntitle = 1\n+++\n",
    "...\ntitle: x\n...\n",
    "---\ntitle: x\n....\n",
    "----\ntitle: x\n---\n",
    "---\ntitle: x\n----\n",
  ]) assert.equal(detectFrontMatter(source), null, JSON.stringify(source));
  const filler = `---\ntitle: x\nbody: |\n${"  y\n".repeat(FRONT_MATTER_LIMIT / 4)}---\n`;
  assert.ok(filler.length > FRONT_MATTER_LIMIT);
  assert.equal(detectFrontMatter(filler), null);
  const edge = `---\ntitle: x\nbody: ${"y".repeat(FRONT_MATTER_LIMIT - 23)}\n---\nrest`;
  assert.equal(edge.indexOf("\n---\n") + 4, FRONT_MATTER_LIMIT);
  assert.equal(detectFrontMatter(edge)!.to, FRONT_MATTER_LIMIT);
  assert.equal(detectFrontMatter(`${edge.slice(0, 4)}y${edge.slice(4)}`), null);
});

test("fields read quotes, block scalars, nested maps, lists, comments and colons in values", () => {
  const fields = readFrontMatterFields([
    'title: "Hello: world"', "single: 'it'", "url: https://sideleaf.xyz/docs?a=b",
    "# a comment", "folded: >-", "  one", "  two", "", "  three", "literal: |", "  line one", "    indented", "  line three",
    "metadata:", "  author: someone", "  version: 2", "tags:", "- a", "- b", "nested:", "  - x", "  - y",
    "inline: [a, b]", "empty:", "unclosed: \"open",
  ]);
  assert.deepEqual(Object.fromEntries(fields.map(({ key, value }) => [key, value])), {
    title: "Hello: world", single: "it", url: "https://sideleaf.xyz/docs?a=b",
    folded: "one two\nthree", literal: "line one\n  indented\nline three",
    metadata: "author: someone\nversion: 2", tags: "- a\n- b", nested: "- x\n- y",
    inline: "[a, b]", empty: "", unclosed: "\"open",
  });
  assert.deepEqual(readFrontMatterFields(["first: line", "  continues here"]), [{ key: "first", value: "line\ncontinues here" }]);
});

test("the glance puts useful keys first, identifiers last, and clips values", () => {
  const glance = frontMatterGlance(detectFrontMatter(note)!.fields);
  assert.equal(glance.text, "type note · created 2026-11-17T23:42:13Z · updated 2026-11-17T23:42:13Z · id 0b1e2c3d…");
  assert.equal(glance.count, "4 fields");
  const skill = frontMatterGlance(readFrontMatterFields([
    "allowed-tools: [Read]", `description: ${"Use this skill when the user wants to fill a form. ".repeat(12)}`, "name: pdf-forms",
  ]));
  assert.deepEqual(skill.items.map((item) => item.key), ["name", "description", "allowed-tools"]);
  assert.equal(skill.items[1]!.value, "Use this skill when the user wants to fill a form. Use this…");
  assert.ok(skill.text.startsWith("name pdf-forms · description Use this skill when the user wants to fill"));
  assert.equal(frontMatterGlance([{ key: "title", value: "x" }]).count, "1 field");
  const ordered = frontMatterGlance(readFrontMatterFields(["uuid: abc", "zeta: 1", "token: 9f86d081884c7d659a2feaa0c55ad015", "Description: d", "tags:", "- a", "- b", "title: T"]));
  assert.deepEqual(ordered.items.map((item) => `${item.key} ${item.value}`), ["title T", "tags a, b", "Description d", "zeta 1", "uuid abc", "token 9f86d081…"]);
  const many = frontMatterGlance(Array.from({ length: 40 }, (_, index) => ({ key: `field${index}`, value: "x ".repeat(40) })));
  assert.ok(many.text.length <= 160, String(many.text.length));
  assert.equal(many.count, "40 fields");
  assert.deepEqual(frontMatterGlance(readFrontMatterFields(["note: one\n\t two   three"])).items[0], { key: "note", value: "one two three" });
});

test("TOML between +++ lines and YAML closed with ... are front matter too", () => {
  const toml = detectFrontMatter('+++ \ntitle = "TOML note"\n[extra]\nmood = "calm"\n+++\t\nBody\n')!;
  assert.deepEqual([toml.to, toml.bodyFrom, toml.fields], [51, 52, [{ key: "title", value: "TOML note" }, { key: "extra", value: 'mood = "calm"' }]]);
  for (const second of ['site.title = "x"', '"quoted key" = 1', "'literal' = 2", "bare_key-1 = true", "[table]", "[[array]]", "[ dotted.table ]"]) {
    assert.ok(detectFrontMatter(`+++\n${second}\n+++\n`), second);
  }
  // A +++ block closes only with +++, and a later --- inside it is text.
  assert.equal(detectFrontMatter("+++\ntitle = 1\n---\nmore = 2\n+++\n")!.raw, "title = 1\n---\nmore = 2");
  const dots = detectFrontMatter("---\ntitle: x\n... \nBody")!;
  assert.deepEqual([dots.to, dots.bodyFrom, dots.raw], [17, 18, "title: x"]);
  assert.equal(detectFrontMatter("---\ntitle: x\n---\n...\n")!.to, 16);
  assert.equal(detectFrontMatter("---\nnote: a\r\n...\r\n")!.fields[0]!.value, "a");
});

test("TOML fields read strings, numbers, arrays, tables and skip comments", () => {
  const fields = readTomlFields([
    'title = "Hello = world"', "literal = 'C:\\path'", "count = 42", "draft = false", "date = 2026-11-17T23:42:13Z",
    "# a comment", 'tags = ["a", "b"]', "list = [", '  "one",', '  "two ]",', "]", 'short = """same line"""',
    'long = """', "  First line", "  # not a comment", '  Last line"""', 'site."quoted".key = 1',
    "[extra]", "  mood = 'calm'", "  # skipped", "  level = 3", "[[authors]]", 'name = "A"',
  ]);
  assert.deepEqual(Object.fromEntries(fields.map(({ key, value }) => [key, value])), {
    title: "Hello = world", literal: "C:\\path", count: "42", draft: "false", date: "2026-11-17T23:42:13Z",
    tags: '["a", "b"]', list: '[\n  "one",\n  "two ]",\n]', short: "same line", long: "First line\n# not a comment\nLast line",
    'site."quoted".key': "1", extra: "mood = 'calm'\nlevel = 3", authors: 'name = "A"',
  });
});

test("the line ends with the field count and the length of the block", () => {
  const matter = detectFrontMatter("---\nname: 🌿 leaf\nnote: two\n---\n")!;
  assert.equal(matter.size, 22);
  const glance = frontMatterGlance(matter.fields, matter.size);
  assert.deepEqual([glance.count, glance.size], ["2 fields", "22 characters"]);
  assert.match(frontMatterLineHTML(glance), /<span class="front-matter-count">2 fields<\/span><span class="front-matter-size"><span class="front-matter-dot"> · <\/span>22 characters<\/span>$/);
  assert.deepEqual([frontMatterGlance([{ key: "a", value: "" }], 1).count, frontMatterGlance([{ key: "a", value: "" }], 1).size], ["1 field", "1 character"]);
  assert.equal(frontMatterGlance([], 12345).size, "12,345 characters");
  assert.doesNotMatch(frontMatterLineHTML(frontMatterGlance([])), /front-matter-size/);
  assert.equal(detectFrontMatter("---\nk: v\n\nw: x y\n---\nbody words")!.words, 7);
});
