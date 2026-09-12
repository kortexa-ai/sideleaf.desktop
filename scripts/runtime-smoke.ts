import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentFile, decodeMarkdown } from "../src/document/files.ts";
import { makeAnchor } from "../src/document/anchors.ts";
import { DocumentWorkspace } from "../src/document/workspace.ts";
import { ActivityJournal } from "../src/collaboration/activity.ts";
import { evaluateApply, focusDraft, threadRevision } from "../src/collaboration/operations.ts";

// Run with the Cottontail binary from the actual packaged app. Node-only tests
// cannot establish compatibility of its filesystem, crypto, or encoding APIs.
function expect(value: boolean, label: string) { if (!value) throw new Error(label); }
const directory = mkdtempSync(join(tmpdir(), "sideleaf-runtime-"));
const path = join(directory, "café-葉.md");
const original = Buffer.from("\uFEFF# Sideleaf\r\n\r\nHello 🌿 café.\r\n");
writeFileSync(path, original);
const file = DocumentFile.open(path);
const draft = file.snapshot();
draft.threads.push({ id: "runtime-comment", state: "open", anchor: makeAnchor(draft.text, 11, 25), messages: [{ id: "runtime-comment", body: "Keep this 🌿", createdAt: "2026-09-07" }] });
file.save(draft);
const annotated = readFileSync(path);
expect(annotated.subarray(0, 3).equals(original.subarray(0, 3)), "UTF-8 BOM changed");
expect(annotated.includes(Buffer.from("\r\n")), "CRLF line endings changed");
const reopened = DocumentFile.open(path).snapshot();
expect(reopened.text === draft.text, "Visible Markdown changed");
expect(reopened.threads[0]?.messages[0]?.body === "Keep this 🌿", "Thread reopen failed");
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
expect(copied.threads[0]?.messages[0]?.body === "Keep this 🌿", "Save As dropped threads");
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
const focused = focusDraft(draft, { contract: "sideleaf-focus/v1", kind: "passage", target: { quote: "Hello 🌿", suffix: " café." }, before: 2, after: 6 });
expect(focused.kind === "passage" && focused.text === "\n\nHello 🌿 café.", "Focused passage changed its exact UTF-16 context");
const evaluated = await evaluateApply(draft, { contract: "sideleaf-apply/v1", ifRevision: file.revision(), operations: [
  { kind: "replace-quote", target: { quote: "Hello 🌿" }, text: "Hello leaf" },
  { kind: "replace-quote", target: { quote: "café" }, text: "cafe" },
] }, { actor: "agent:runtime", currentRevision: file.revision() });
expect(evaluated.draft.text.includes("Hello leaf cafe."), "Sequential quote batch failed");
const proposed = await evaluateApply(evaluated.draft, { contract: "sideleaf-apply/v1", operations: [
  { kind: "suggestion-add", target: { quote: "Hello leaf", suffix: " cafe." }, replacement: "Hello greener leaf", body: "Make the wording specific." },
] }, { actor: "agent:runtime", currentRevision: file.revision() });
const suggestion = proposed.draft.threads.find((thread) => thread.suggestion)!;
expect(suggestion.suggestion?.state === "pending" && proposed.draft.text === evaluated.draft.text, "Suggestion creation changed source");
const accepted = await evaluateApply(proposed.draft, { contract: "sideleaf-apply/v1", operations: [
  { kind: "suggestion-accept", threadId: suggestion.id, ifThreadRevision: await threadRevision(suggestion) },
] }, { actor: "human:runtime", currentRevision: file.revision() });
expect(accepted.draft.text.includes("Hello greener leaf cafe.") && accepted.draft.threads.find((thread) => thread.id === suggestion.id)?.suggestion?.state === "accepted", "Suggestion acceptance was not atomic");
const journal = new ActivityJournal("11111111-1111-4111-8111-111111111111"), documentId = "22222222-2222-4222-8222-222222222222";
const cursor = journal.cursor(documentId); journal.record(documentId, { kind: "source-applied", actor: "agent:runtime" });
expect(journal.scan(documentId, cursor).outcome === "event", "Semantic activity cursor missed a completed event");
console.log(JSON.stringify({ event: "sideleaf-runtime-smoke", result: "passed", platform: process.platform, architecture: process.arch, directory, checks: ["unicode-path", "utf8-bom", "crlf", "atomic-save", "comment-reopen", "external-conflict", "cached-conflict", "content-restoration", "invalid-encoding", "save-as", "folder-listing", "independent-sessions", "rename-identity", "failed-trash", "folder-watching", "focus-passage", "atomic-quote-batch", "suggestion-create-accept", "semantic-cursor"] }));
