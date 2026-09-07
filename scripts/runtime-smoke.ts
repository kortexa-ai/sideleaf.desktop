import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentFile, decodeMarkdown } from "../src/document/files.ts";
import { makeAnchor } from "../src/document/anchors.ts";

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
expect(Buffer.compare(readFileSync(path), original) === 0, "UTF-8 BOM/CRLF bytes changed");
expect(DocumentFile.open(path).snapshot().comments[0]?.body === "Keep this 🌿", "Comment reopen failed");
writeFileSync(path, Buffer.from("Another writer\r\n"));
expect(file.changed(), "External change was missed");
let conflict = false;
try { file.save(draft); } catch { conflict = true; }
expect(conflict, "A conflicting save was accepted");
let badEncoding = false;
try { decodeMarkdown(Uint8Array.of(0xff)); } catch { badEncoding = true; }
expect(badEncoding, "Invalid UTF-8 was accepted");
const copy = join(directory, "copy.md");
file.save(draft, copy);
expect(Buffer.compare(readFileSync(copy), original) === 0, "Save As did not preserve bytes");
console.log(JSON.stringify({ event: "sideleaf-runtime-smoke", result: "passed", platform: process.platform, architecture: process.arch, directory, checks: ["unicode-path", "utf8-bom", "crlf", "atomic-save", "comment-reopen", "external-conflict", "invalid-encoding", "save-as"] }));
