import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentWorkspace, FolderRoot } from "../src/document/workspace.ts";
import { acquireDocumentLock, DocumentFile } from "../src/document/files.ts";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sideleaf-workspace-")));
  mkdirSync(join(root, "Notes")); mkdirSync(join(root, "Empty"));
  writeFileSync(join(root, "A.md"), "Alpha\n"); writeFileSync(join(root, "Notes", "B.md"), "Beta\n");
  return root;
}
test("app open waits asynchronously and registers ownership before releasing the document lock", async () => {
  const root = fixture(), path = realpathSync(join(root, "A.md"));
  const writer = acquireDocumentLock(path), workspace = new DocumentWorkspace();
  const opening = workspace.openOwned(path), raced = workspace.openOwned(path);
  await new Promise((accept) => setTimeout(accept, 40));
  assert.equal(workspace.sessions.size, 0);
  writer.release();
  const opened = await opening;
  const second = await raced;
  assert.equal(second.document!.id, opened.document!.id);
  assert.equal(workspace.get(opened.document!.id).file.path, path);
  assert.equal(existsSync(`${path}.sideleaf.lock`), false);
});
test("opening a folder does not load documents; nested entries are lazy, filtered and naturally sorted", () => {
  const root = fixture(); mkdirSync(join(root, ".obsidian")); mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "z10.md"), "10"); writeFileSync(join(root, "z2.md"), "2");
  writeFileSync(join(root, "Notes", "bad.md"), Buffer.from([0xff])); writeFileSync(join(root, "picture.png"), "image");
  const workspace = new DocumentWorkspace();
  try {
    const opened = workspace.openFolder(root);
    assert.equal(opened.document, null); assert.equal(workspace.sessions.size, 0);
    assert.equal(opened.workspace.explicit, true);
    assert.deepEqual(workspace.root!.list("").entries.map((item) => item.name), ["Empty", "Notes", "A.md", "z2.md", "z10.md"]);
    assert.equal(workspace.root!.list("Notes").entries.length, 2);
    assert.equal(workspace.sessions.size, 0);
    assert.throws(() => workspace.openEntry(opened.workspace.id, "Notes/bad.md"), /UTF-8/);
    assert.equal(workspace.sessions.size, 0);
  } finally { workspace.reset(); }
});
test("tree navigation promotes a standalone root and retains stable file sessions, dirty state and transfers", () => {
  const root = fixture(), workspace = new DocumentWorkspace();
  try {
    const a = workspace.open(join(root, "A.md")); const id = a.document!.id;
    assert.equal(a.workspace.explicit, false);
    const session = workspace.get(id); session.dirty = true;
    const raw = JSON.stringify({ text: "Edited Alpha", comments: [] });
    session.transfer.append({ transferId: "save-a", index: 0, total: 1, text: raw });
    const b = workspace.openEntry(a.workspace.id, "Notes/B.md");
    assert.equal(b.workspace.root, root); assert.equal(b.workspace.explicit, true);
    assert.equal(workspace.dirty, true); assert.equal(workspace.sessions.size, 2);
    assert.equal(workspace.openEntry(a.workspace.id, "A.md").document!.id, id);
    assert.equal(workspace.get(id), session);
    session.file.save(session.transfer.take("save-a"));
    assert.equal(readFileSync(join(root, "A.md"), "utf8"), "Edited Alpha");
    assert.equal(readFileSync(join(root, "Notes/B.md"), "utf8"), "Beta\n");
    const created = workspace.newDocument(); assert.equal(created.workspace.root, root); assert.equal(created.document!.path, null);
    assert.equal(workspace.sessions.size, 3);
    workspace.closeDocument(created.document!.id); assert.equal(workspace.sessions.size, 2);
    assert.throws(() => workspace.get(created.document!.id), /closed/);
  } finally { workspace.reset(); }
});
test("root replacement invalidates old requests and failed opens preserve the workspace", () => {
  const root = fixture(), workspace = new DocumentWorkspace();
  const before = workspace.openFolder(root);
  assert.throws(() => workspace.openFolder(join(root, "missing")));
  assert.equal(workspace.info().id, before.workspace.id);
  const after = workspace.openFolder(join(root, "Notes"));
  assert.notEqual(after.workspace.id, before.workspace.id);
  assert.throws(() => workspace.openEntry(before.workspace.id, "A.md"), /earlier folder/);
  workspace.reset();
});
test("folder requests reject traversal, directory replacements and links or junctions escaping the root", () => {
  const root = fixture(), outside = fixture(), folder = new FolderRoot(root);
  assert.throws(() => folder.resolve("../A.md")); assert.throws(() => folder.resolve(outside));
  const link = join(root, "escape");
  symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(folder.list("").entries.some((item) => item.name === "escape"), false);
  assert.throws(() => folder.resolve("escape/A.md"), /outside|Links/);
  renameSync(root, `${root}-moved`); mkdirSync(root);
  assert.throws(() => folder.resolve(""), /replaced/); folder.close();
});
test("Save As cannot target a different open file and standalone roots follow saves", () => {
  const root = fixture(), workspace = new DocumentWorkspace();
  try {
    const a = workspace.open(join(root, "A.md")); const b = workspace.openEntry(a.workspace.id, "Notes/B.md");
    assert.throws(() => workspace.assertSaveTarget(a.document!.id, b.document!.path!), /already open/);
    workspace.reset(); const draft = workspace.newDocument().document!;
    workspace.get(draft.id).file.save({ text: "New", comments: [] }, join(root, "new.md")); workspace.refreshRootAfterSave(draft.id);
    assert.equal(workspace.info().root, root); assert.equal(workspace.info().explicit, false);
  } finally { workspace.reset(); }
});
test("renaming preserves identity and dirty edits, refuses collisions and stale disk contents", () => {
  const root = fixture(), file = DocumentFile.open(join(root, "A.md")); const id = file.id, revision = file.revision();
  const draft = { text: "Unsaved editor text", comments: [] };
  const renamed = file.rename("café 文 🌿.md");
  assert.equal(renamed.id, id); assert.equal(file.revision(), revision); assert.equal(file.pollChanged(), false);
  assert.equal(existsSync(join(root, "A.md")), false);
  assert.equal(readFileSync(renamed.path!, "utf8"), "Alpha\n");
  file.save(draft); assert.equal(readFileSync(renamed.path!, "utf8"), draft.text);
  writeFileSync(join(root, "exists.md"), "existing"); assert.throws(() => file.rename("exists.md"), /already exists/);
  for (const name of ["../escape.md", "CON.md", "bad.txt.", "bad.json", "bad:name.md"]) assert.throws(() => file.rename(name));
  writeFileSync(renamed.path!, "External"); assert.throws(() => file.rename("next.md"), /changed on disk/);
  assert.equal(existsSync(join(root, "next.md")), false);
  assert.equal(file.reload().id, id);
  if (process.platform !== "win32") assert.equal(statSync(renamed.path!).mode & 0o777, 0o644);
});
test("rename refuses active locks and missing files without changing another writer's lock", () => {
  const root = fixture(), file = DocumentFile.open(join(root, "A.md"));
  const lock = `${file.path}.sideleaf.lock`; writeFileSync(lock, "writer");
  assert.throws(() => file.rename("next.md")); assert.equal(readFileSync(lock, "utf8"), "writer");
  unlinkSync(lock); unlinkSync(file.path!); assert.throws(() => file.rename("next.md"));
  assert.equal(existsSync(join(root, "next.md")), false);
});

test("Trash refuses locks and stale data, and failed trash retains the file", () => {
  const root = fixture(), file = DocumentFile.open(join(root, "A.md")), lock = `${file.path}.sideleaf.lock`;
  assert.throws(() => file.trash(() => false), /still open/);
  assert.equal(readFileSync(file.path!, "utf8"), "Alpha\n"); assert.equal(existsSync(lock), false);
  writeFileSync(lock, "writer"); assert.throws(() => file.trash(() => { throw new Error("must not run"); }));
  assert.equal(readFileSync(lock, "utf8"), "writer"); unlinkSync(lock);
  writeFileSync(file.path!, "External"); assert.throws(() => file.trash(() => true), /changed on disk/);
  file.reload(); const destination = join(root, "trashed.md");
  file.trash((path) => { assert.equal(existsSync(lock), true); renameSync(path, destination); return true; });
  assert.equal(readFileSync(destination, "utf8"), "External"); assert.equal(existsSync(lock), false);
});

test("explicit folder launch resolves a directory alias without allowing tree traversal through links", () => {
  const root = fixture(), parent = fixture(), alias = join(parent, "alias"), workspace = new DocumentWorkspace();
  symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(workspace.open(alias).workspace.root, root); assert.equal(workspace.info().explicit, true);
  workspace.reset();
});
