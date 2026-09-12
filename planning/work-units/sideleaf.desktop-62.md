# Sideleaf 62 — shared review suggestions

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/62>
Program design: [sideleaf.desktop-59.md](sideleaf.desktop-59.md)
Collaboration prerequisite: [sideleaf.desktop-61.md](sideleaf.desktop-61.md)

## Suggestion contract

A review thread may contain one versioned suggestion with pending, accepted or
rejected state, its exact original and replacement text, optional full selector
context, and terminal decision attribution. `suggestion-add` resolves a unique quote
and records a normal root discussion message without changing source. Unique quote
creation tolerates unrelated source edits; an optional document revision can guard
the complete batch.

`suggestion-accept` and `suggestion-reject` use the thread's batch-start semantic
revision. Accept rechecks pending state, the attached anchor, stored selector and
exact original immediately before applying the replacement and decision together.
Reject changes only suggestion state. Either operation composes with other source
and thread work in the shared temporary-draft evaluator and commits as one editor
transaction or not at all. Missing, changed, orphaned, ambiguous, stale and already
decided targets fail visibly.

Portable metadata, scratch and recovery use version 3. Version-1 comments and
version-2 threads migrate in memory with IDs, anchors, messages, attribution and
retained history unchanged. The next explicit save writes version 3. Unsupported
older readers refuse the file before changing it.

## Validation gate

- Evaluator tests cover exact/full-context creation, multiline and Unicode
  replacements, empty deletion, semantic and optional document guards, stale and
  ambiguous targets, sequential same-thread decisions, mixed-batch rollback and
  one-step CodeMirror undo/redo.
- Persistence tests cover strict suggestion validation, version-1/version-2
  migration, retained history, BOM/CRLF and private-mode preservation, scratch and
  recovery, plus refusal by the actual archived version-2 packaged CLI.
- CLI, packaged-runtime and native checks cover dedicated commands and generic
  batches, compact receipts, live/offline and active/inactive buffers, autosave,
  wait events, WSL path translation, human decisions, save/reopen and undo/redo on
  macOS and Windows.
