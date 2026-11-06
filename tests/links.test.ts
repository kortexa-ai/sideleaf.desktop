import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { previewLinkKind } from "../src/ui/links.ts";
import { resolveRelativeLink } from "../src/platform/file-open.ts";

test("document links resolve against the saved file, preserving encoded filename characters", () => {
  const root = join(tmpdir(), "Sideleaf café"), document = join(root, "docs", "a.md");
  assert.deepEqual(resolveRelativeLink("../notes%20%E8%91%89.md#caf%C3%A9", document), {
    path: join(root, "notes 葉.md"), fragment: "café",
  });
  assert.deepEqual(resolveRelativeLink("./file%23name%3F.md", document), { path: join(root, "docs", "file#name?.md"), fragment: null });
  assert.deepEqual(resolveRelativeLink("./a.md?view=1#here", document), { path: document, fragment: "here" });
  assert.throws(() => resolveRelativeLink("notes.md", null), /Save this document/);
  assert.throws(() => resolveRelativeLink("https://example.com", document), /Only relative/);
  assert.throws(() => resolveRelativeLink("a%2Fb.md", document));
  assert.throws(() => resolveRelativeLink("a.md#%", document));
});

test("preview actions have a closed scheme policy", () => {
  assert.equal(previewLinkKind("docs/guide.md"), "relative");
  assert.equal(previewLinkKind("#heading"), "fragment");
  assert.equal(previewLinkKind("https://example.com/a"), "external");
  assert.equal(previewLinkKind("mailto:writer@example.com"), "external");
  for (const url of ["", "javascript:alert(1)", "file:///a.md", "views://main", "//server/a", "\\\\server\\a", "a\nb", "a b", "/a.md", "?x=1"]) assert.equal(previewLinkKind(url), null);
});
