# Sideleaf 61 — atomic batches, focused reads and semantic waits

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/61>
Program design: [sideleaf.desktop-59.md](sideleaf.desktop-59.md)
Ownership prerequisite: [sideleaf.desktop-60.md](sideleaf.desktop-60.md)
Thread prerequisite: [sideleaf.desktop-35.md](sideleaf.desktop-35.md)

## Collaboration contract

`sideleaf-apply/v1` accepts 1–64 sequential source and review-thread operations.
Offset source replacements and thread additions use the starting document revision.
Exact-quote operations tolerate unrelated source edits when the quote/context stays
unique; an optional document revision guards any complete batch. Existing-thread
operations carry the target's batch-start semantic revision. Evaluation happens on a temporary draft; the complete batch
commits as one guarded CodeMirror transaction and one undo step, or it makes no
change. Receipts contain per-operation input coordinates plus created and changed
thread/message IDs. Surviving source changes are highlighted in their final mapped
locations.

`sideleaf-focus/v1` reads a bounded UTF-16 range, one exact passage with context, or
one complete thread with its semantic revision. Every full read, focus result and
apply receipt carries the activity cursor captured with that snapshot or commit.

`wait` emits one semantic event or a bounded timeout, app-close or resync result.
Actor exclusion, thread and mention filters combine. Live cursors bind to one app
instance and document journal; future, missing, restarted and closed-document states
resync. Each open document retains at most 256 semantic events and drops its journal
when it closes. Offline cursors bind to a saved revision; waits use stat polling,
recheck ownership and resync rather than skip multiple matching changes.

## Validation gate

- Pure tests cover sequential batch coordinates, exact/ambiguous/overlapping quote
  matching, Unicode boundaries, whole-batch refusal, thread guard reuse, selection
  mapping, final highlights and one-step undo.
- Journal tests cover filters, response-before-wait, restart/future/repeated gaps,
  bounded retention, duplicate delivery, document close, local thread undo/redo and
  metadata-only edits.
- CLI and packaged-runtime checks cover focus shapes, legacy single-operation
  compatibility, live/offline batches, quiet timeouts, offline-to-live handoff and
  CMD/WSL operand routing without Node or Bun on `PATH`.
- Native macOS and Windows acceptance exercises actual live buffers, active/inactive
  targeting, cursor/read overlap, native undo/redo, autosave and app/document close.
