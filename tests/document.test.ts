import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, statSync, chmodSync, mkdirSync, symlinkSync, realpathSync, existsSync, readdirSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { splitMetadata } from "../src/document/metadata.ts";
import { acquireDocumentLock, acquireDocumentLockAsync, wslLocation, DocumentFile, decodeMarkdown } from "../src/document/files.ts";
import { makeAnchor, relocateComment } from "../src/document/anchors.ts";
import { validateDraft } from "../src/shared/contracts.ts";

const fixture = (bytes = Buffer.from("# Notes\n\nHello 🌿 café.\n")) => {
  const folder = mkdtempSync(join(tmpdir(), "sideleaf-test-"));
  const path = join(folder, "notes.md"); writeFileSync(path, bytes); return { folder, path };
};

test("one held document lock covers a coherent offline load and save", async () => {
  const { path } = fixture();
  const lock = acquireDocumentLock(realpathSync(path));
  const waiting = acquireDocumentLockAsync(realpathSync(path), { timeoutMs: 500 });
  await new Promise((accept) => setTimeout(accept, 40));
  const file = DocumentFile.open(path, lock), draft = file.snapshot();
  draft.text = "Guarded handoff\n";
  file.save(draft, undefined, "agent:test", lock);
  assert.equal(existsSync(`${path}.sideleaf.lock`), true);
  lock.release();
  const next = await waiting; next.release();
  assert.equal(existsSync(`${path}.sideleaf.lock`), false);
  assert.equal(DocumentFile.open(path).snapshot().text, "Guarded handoff\n");
});

test("a literal UTF-8 BOM/CRLF file survives comment save without rewriting", () => {
  const bytes = Buffer.from("\uFEFF# Notes\r\n\r\nHello 🌿 café.\r\n");
  const { path } = fixture(bytes); const file = DocumentFile.open(path);
  const draft = file.snapshot();
  draft.threads.push({ id: "one", state: "open", anchor: makeAnchor(draft.text, 9, 22), messages: [{ id: "one", createdAt: "2026-09-07", body: "Keep this wording" }] });
  file.save(draft);
  assert.equal(splitMetadata(decodeMarkdown(readFileSync(path)).text).text, decodeMarkdown(bytes).text);
  const reopened = DocumentFile.open(path).snapshot();
  assert.deepEqual(reopened.threads, draft.threads);
  assert.equal(reopened.lineEnding, "\r\n");
});

test("disk edits, metadata edits, deletion, and replacement cannot silently overwrite a draft", () => {
  const { path } = fixture(); const file = DocumentFile.open(path); const draft = { ...file.snapshot(), text: "My unsaved draft" };
  writeFileSync(path, "Another writer"); assert.equal(file.changed(), true);
  assert.throws(() => file.save(draft), /changed on disk/); assert.equal(readFileSync(path, "utf8"), "Another writer");
  const loaded = file.reload(); assert.equal(loaded.text, "Another writer");
  writeFileSync(`${path}.sideleaf.json`, "bad metadata");
  assert.throws(() => file.save({ ...loaded, text: "Mine" }), /changed on disk/);
});

test("plain save preserves mode and leaves no sidecar until comments exist", () => {
  const { path } = fixture(); if (process.platform !== "win32") chmodSync(path, 0o640);
  const file = DocumentFile.open(path); file.save({ text: "# Edited\n", threads: [] });
  assert.equal(readFileSync(path, "utf8"), "# Edited\n");
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o640);
  assert.equal(file.changed(), false);
  assert.equal(file.pollChanged(), false);
});

test("disk polling caches both clean and conflicting comparisons", () => {
  const { path } = fixture(); const original = readFileSync(path);
  const file = DocumentFile.open(path);
  const compare = file.changed.bind(file);
  let fullChecks = 0;
  file.changed = () => { fullChecks++; return compare(); };
  for (let i = 0; i < 30; i++) assert.equal(file.pollChanged(), false);
  assert.equal(fullChecks, 0);
  // A same-content touch needs one full comparison, then stays cheap.
  utimesSync(path, new Date(0), new Date(0));
  assert.equal(file.pollChanged(), false);
  assert.equal(file.pollChanged(), false);
  assert.equal(fullChecks, 1);
  writeFileSync(path, "Another writer\n");
  assert.equal(file.pollChanged(), true);
  assert.equal(fullChecks, 2);
  // A known conflict must remain visible without comparing its bytes again.
  for (let i = 0; i < 30; i++) assert.equal(file.pollChanged(), true);
  assert.equal(fullChecks, 2);
  assert.throws(() => file.save({ text: "My draft", threads: [] }), /changed on disk/);
  assert.equal(file.pollChanged(), true);
  assert.equal(fullChecks, 2);
  // Restoring the open content invalidates the conflict and caches clean again.
  writeFileSync(path, original);
  assert.equal(file.pollChanged(), false);
  for (let i = 0; i < 30; i++) assert.equal(file.pollChanged(), false);
  assert.equal(fullChecks, 3);
  // Explicit content checks remain exact, even with a cached poll result.
  assert.equal(file.changed(), false);
  assert.equal(fullChecks, 4);
});

test("disk polling notices preserved mtime, sidecar changes, deletion and recovery", () => {
  const { path } = fixture();
  // Use an exactly representable mtime so restoring it does not itself change
  // the fingerprint through rounding to Date's millisecond precision.
  utimesSync(path, new Date(1000), new Date(1000));
  const file = DocumentFile.open(path);
  const before = statSync(path);
  const bytes = readFileSync(path);
  bytes[0] = bytes[0] === 65 ? 66 : 65;
  writeFileSync(path, bytes);
  utimesSync(path, before.atime, before.mtime);
  assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  assert.equal(file.pollChanged(), true);
  file.reload();
  assert.equal(file.pollChanged(), false);
  // A sidecar appearing changes the comparison even when Markdown is unchanged.
  writeFileSync(`${path}.sideleaf.json`, "{}");
  assert.equal(file.pollChanged(), true);
  assert.equal(file.pollChanged(), true);
  // Removing it restores the open state and clears the cached conflict.
  unlinkSync(`${path}.sideleaf.json`);
  assert.equal(file.pollChanged(), false);
  // Failed reads must keep failing on later polls, never reuse a clean result.
  unlinkSync(path);
  assert.throws(() => file.pollChanged());
  assert.throws(() => file.pollChanged());
  writeFileSync(path, bytes);
  assert.equal(file.pollChanged(), false);
});

test("reload, Save As and save establish a clean poll baseline", () => {
  const { path, folder } = fixture(); const file = DocumentFile.open(path);
  assert.equal(new DocumentFile().pollChanged(), false);
  writeFileSync(path, "External revision\n");
  assert.equal(file.pollChanged(), true);
  const draft = file.reload();
  assert.equal(file.pollChanged(), false);
  writeFileSync(path, "Another external revision\n");
  assert.equal(file.pollChanged(), true);
  const copy = join(folder, "copy.md");
  file.save(draft, copy);
  assert.equal(file.pollChanged(), false);
  file.save({ text: "Saved edit\n", threads: [] });
  assert.equal(file.pollChanged(), false);
  assert.equal(readFileSync(copy, "utf8"), "Saved edit\n");
});

test("Save As keeps the original document and rejects another document's annotations", () => {
  const { path, folder } = fixture(); const file = DocumentFile.open(path); const original = readFileSync(path);
  const target = join(folder, "copy.md"); file.save({ text: "New copy", threads: [] }, target);
  assert.deepEqual(readFileSync(path), original); assert.equal(file.path, realpathSync(target));
  const collision = join(folder, "annotated.md"); writeFileSync(collision, "Other"); writeFileSync(`${collision}.sideleaf.json`, "{}");
  assert.throws(() => file.save({ text: "Oops", threads: [] }, collision), /already has Sideleaf comments/);
  assert.equal(readFileSync(collision, "utf8"), "Other");
});

test("legacy interrupted-save recovery migrates both revisions into a portable file", () => {
  const { path, folder } = fixture(); const original = readFileSync(path);
  const old = DocumentFile.open(path).snapshot();
  const oldComment = { id: "old", body: "Original", createdAt: "2026-09-07", anchor: makeAnchor(old.text, 2, 7) };
  const revisions = [
    { sourceHash: createHash("sha256").update("failed new source").digest("hex"), comments: [] },
    { sourceHash: createHash("sha256").update(original).digest("hex"), comments: [oldComment] },
  ];
  writeFileSync(`${path}.sideleaf.json`, JSON.stringify({ format: "sideleaf-comments", version: 1, revisions }));
  const file = DocumentFile.open(path); assert.match(file.snapshot().notice!, /interrupted save/);
  file.save(file.snapshot());
  assert.equal(existsSync(`${path}.sideleaf.json`), false);
  assert.ok(readdirSync(folder).some((name) => name.includes(".migrated-")));
  assert.equal(DocumentFile.open(path).snapshot().threads[0]!.id, oldComment.id);
  assert.equal(DocumentFile.open(path).history().length, 3);
  const copy = join(folder, "only-markdown.md"); writeFileSync(copy, readFileSync(path));
  assert.equal(DocumentFile.open(copy).snapshot().threads[0]!.messages[0]!.body, oldComment.body);
});

test("failed destination writes leave original bytes intact", () => {
  const { path, folder } = fixture(); const file = DocumentFile.open(path); const bytes = readFileSync(path);
  const directory = join(folder, "directory.md"); mkdirSync(directory);
  assert.throws(() => file.save({ text: "changed", threads: [] }, directory), /regular file/);
  assert.deepEqual(readFileSync(path), bytes);
});

test("invalid UTF-8, NUL and mixed line endings are explicit unsupported formats", () => {
  assert.throws(() => decodeMarkdown(Uint8Array.of(0xff, 0xfe)), /not valid UTF-8/);
  assert.throws(() => decodeMarkdown(Buffer.from("a\u0000b")), /NUL/);
  assert.throws(() => decodeMarkdown(Buffer.from("a\r\nb\n")), /Mixed/);
  assert.throws(() => decodeMarkdown(Buffer.from("a\rb")), /Mixed/);
  assert.throws(() => decodeMarkdown(Buffer.from("a\r\r\nb")), /Mixed/);
  assert.throws(() => decodeMarkdown(Buffer.from("a\r")), /Mixed/);
});

test("decodeMarkdown classifies pure CRLF and LF content in one pass", () => {
  assert.deepEqual(decodeMarkdown(Buffer.from("a\r\nb\r\nc")), { text: "a\nb\nc", bom: false, lineEnding: "\r\n" });
  assert.deepEqual(decodeMarkdown(Buffer.from("a\nb\nc")), { text: "a\nb\nc", bom: false, lineEnding: "\n" });
  assert.deepEqual(decodeMarkdown(Buffer.from("abc")), { text: "abc", bom: false, lineEnding: "\n" });
});

test("the name accessor matches snapshot metadata for untitled and saved documents", () => {
  const untitled = DocumentFile.fromDraft({ text: "Hello\n", threads: [] });
  assert.equal(untitled.name, "Untitled.md");
  assert.equal(untitled.snapshot().name, "Untitled.md");
  const { path } = fixture(); writeFileSync(path, "Hello\n");
  const file = DocumentFile.open(path);
  assert.equal(file.name, "notes.md");
  assert.equal(file.snapshot().name, "notes.md");
});

test("external relocation requires unambiguous quotation and context", () => {
  const text = "# Notes\n\nHello 🌿 café.\n";
  const comment = { id: "a", body: "Interesting", createdAt: "2026-09-07", anchor: makeAnchor(text, 9, 22) };
  const moved = relocateComment(comment, `Before\n${text}`, false);
  assert.equal(moved.anchor.from, 16); assert.equal(moved.anchor.state, "attached");
  assert.equal(relocateComment(comment, `${text}${text}`, false).anchor.state, "orphaned");
  assert.equal(relocateComment(comment, text.replace("Hello", "Goodbye"), false).anchor.state, "orphaned");
});

test("bridge validation rejects forged anchors", () => {
  assert.throws(() => validateDraft({ text: "Hello", threads: [{ id: "x", state: "open", messages: [{ id: "x", body: "x", createdAt: "today" }], anchor: makeAnchor("Other", 0, 5) }] }), /no longer matches/);
  const anchor = makeAnchor("Hello", 0, 5);
  assert.throws(() => validateDraft({ text: "Hello", threads: [{ id: "x", state: "open", anchor, messages: [
    { id: "x", body: "root", createdAt: "today" }, { id: "x", body: "duplicate", createdAt: "today" },
  ] }] }), /Invalid thread message/);
});

test("opening a symlink saves its resolved target without replacing the link", { skip: process.platform === "win32" }, () => {
  const { path, folder } = fixture(); const link = join(folder, "link.md"); symlinkSync(path, link);
  DocumentFile.open(link).save({ text: "Updated", threads: [] });
  assert.equal(readFileSync(path, "utf8"), "Updated");
});


test("WSL file locations distinguish distro UNC paths from ordinary network shares", () => {
  assert.deepEqual(wslLocation("\\\\wsl.localhost\\Ubuntu\\home\\francip\\notes café.md"), { distro: "Ubuntu", path: "/home/francip/notes café.md" });
  assert.deepEqual(wslLocation(String.raw`\\wsl$\Ubuntu Dev\tmp\notes.md`), { distro: "Ubuntu Dev", path: "/tmp/notes.md" });
  assert.equal(wslLocation(String.raw`\\server\share\notes.md`), null);
  assert.equal(wslLocation(String.raw`C:\notes.md`), null);
});
