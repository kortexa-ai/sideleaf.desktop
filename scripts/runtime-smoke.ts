import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentFile, decodeMarkdown } from "../src/document/files.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { DocumentWorkspace } from "../src/document/workspace.ts";

// Run with the Cottontail binary from the actual packaged app. Node-only tests
// cannot establish compatibility of its filesystem, crypto, or encoding APIs.
function expect(value: boolean, label: string) { if (!value) throw new Error(label); }
const directory = mkdtempSync(join(tmpdir(), "sideleaf-runtime-"));
const path = join(directory, "café-葉.md");
const original = Buffer.from("\uFEFF# Sideleaf\r\n\r\nHello 🌿 café.\r\n");
writeFileSync(path, original);
const file = DocumentFile.open(path);
const draft = file.snapshot();
draft.comments.push({ id: "runtime-comment", body: "Keep this 🌿", createdAt: "2026-09-07", anchor: makeAnchor(draft.text, 11, 25) });
file.save(draft);
const annotated = readFileSync(path);
expect(annotated.subarray(0, 3).equals(original.subarray(0, 3)), "UTF-8 BOM changed");
expect(annotated.includes(Buffer.from("\r\n")), "CRLF line endings changed");
const reopened = DocumentFile.open(path).snapshot();
expect(reopened.text === draft.text, "Visible Markdown changed");
expect(reopened.comments[0]?.body === "Keep this 🌿", "Comment reopen failed");
writeFileSync(path, Buffer.from("Another writer\r\n"));
expect(file.pollChanged(), "External change was missed");
for (let i = 0; i < 30; i++) expect(file.pollChanged(), "A cached conflict disappeared");
let conflict = false;
try { file.save(draft); } catch { conflict = true; }
expect(conflict, "A conflicting save was accepted");
writeFileSync(path, annotated);
expect(!file.pollChanged(), "Restored content still conflicts");
expect(!file.pollChanged(), "A cached clean result changed");
let badEncoding = false;
try { decodeMarkdown(Uint8Array.of(0xff)); } catch { badEncoding = true; }
expect(badEncoding, "Invalid UTF-8 was accepted");
const copy = join(directory, "copy.md");
file.save(draft, copy);
const copied = DocumentFile.open(copy).snapshot();
expect(copied.text === draft.text, "Save As changed visible Markdown");
expect(copied.comments[0]?.body === "Keep this 🌿", "Save As dropped comments");
expect(readFileSync(copy).subarray(0, 3).equals(original.subarray(0, 3)), "Save As changed the UTF-8 BOM");
const workspace = new DocumentWorkspace();
workspace.openFolder(directory);
const root = workspace.root!;
expect(root.list("").entries.some((entry) => entry.name === "copy.md"), "Native directory listing failed");
const opened = workspace.openEntry(root.id, "copy.md").document!;
const session = workspace.get(opened.id); session.dirty = true;
workspace.newDocument();
expect(workspace.dirty && workspace.sessions.size === 2, "New lost the inactive document");
session.file.rename("renamed 文.md");
expect(session.file.id === opened.id && session.file.snapshot().text === draft.text, "Rename lost document identity or content");
let trashRefused = false;
try { session.file.trash(() => false); } catch { trashRefused = true; }
expect(trashRefused && DocumentFile.open(session.file.path!).snapshot().text === draft.text, "Failed Trash lost the file");
root.watch([""]); root.watch([]); workspace.reset();
console.log(JSON.stringify({ event: "sideleaf-runtime-smoke", result: "passed", platform: process.platform, architecture: process.arch, directory, checks: ["unicode-path", "utf8-bom", "crlf", "atomic-save", "comment-reopen", "external-conflict", "cached-conflict", "content-restoration", "invalid-encoding", "save-as", "folder-listing", "independent-sessions", "rename-identity", "failed-trash", "folder-watching"] }));
