# Sideleaf 35 — portable review threads

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/35>
Program design: [sideleaf.desktop-59.md](sideleaf.desktop-59.md)
Ownership prerequisite: [sideleaf.desktop-60.md](sideleaf.desktop-60.md)

## Thread contract

Embedded `sideleaf-comments` metadata version 2 stores anchored review threads.
Each thread has a stable ID, open or resolved state, optional resolution attribution,
and ordered messages with stable IDs and creation/edit attribution. The root message
shares the thread ID. Version-1 comments migrate to open one-message threads without
changing their IDs, anchors, authors or retained revisions; missing legacy authors
remain absent. The next explicit save writes version 2, which unsupported older
readers reject before changing the file.

The sidebar shows Open, Resolved and All counts. A local writer can add a root,
reply, edit any message, delete a reply, resolve, reopen or explicitly delete a
thread. Deleting a whole thread requires confirmation. Pending root, reply and edit
text belongs to its editor buffer, participates in dirty/leave handling and private
recovery, and survives buffer changes and rerenders. A changed or deleted target is
shown for explicit reconciliation while preserving the unfinished text.

## CLI compatibility and guards

`threads` returns ordered thread objects with a semantic revision for each thread.
`thread-add` uses the whole-document revision. Reply, message update/delete,
resolve/reopen and thread delete use the target thread's semantic revision; callers
may also supply the document revision when unrelated source changes must conflict.
The semantic value includes state and message identity/content/attribution while
excluding the relocatable anchor. Generic `apply` accepts the same single-operation
objects.

Legacy `comments` remains a root-only projection. `comment-add` creates a root
thread, and `comment-update` changes only that root while preserving replies, state
and history. `comment-remove` refuses a thread with replies; explicit `thread-delete`
is required for destructive removal. Retained revisions expose both `threads` and
the compatibility `comments` projection. Every new write follows the live ownership
route when the app owns the document, including inactive and untitled buffers.

Markdown and plain-text files use the same thread format. Source offsets remain
end-exclusive UTF-16 positions in logical-LF text; saves preserve BOM, line endings
and supported file modes.

## Validation

- Schema and migration tests cover stable v1 IDs, unattributed legacy messages,
  retained history, duplicate IDs, explicit v2 upgrade, older-reader refusal and
  v1 scratch/recovery records.
- CLI tests cover the complete offline and live thread lifecycle, semantic conflicts,
  legacy root compatibility, Unicode paths, `.txt`, WSL command routing and the
  packaged runtime without Node or Bun on `PATH`.
- Editor tests cover one-step undo/redo, active and inactive buffers, guarded async
  commits, pending-draft durability, missing targets and concurrent human changes.
- Native macOS and Windows acceptance exercises migration, sidebar actions, draft
  focus/recovery, autosave, CLI-owned live buffers and exact byte preservation.

## Acceptance

Native acceptance completed against code commit
`466f45939740229db109e84548e2b3ae37f0e4ef` on macOS and Windows:

- The pinned native builds passed 118/118 tests on macOS and 115/115 with three
  expected platform skips on Windows. Both packaged CLIs passed their thread,
  ownership, Unicode, revision and lock checks with Bun and Node absent from
  `PATH`.
- Visible desktop checks migrated version-1 Markdown threads with stable IDs,
  anchors, missing attribution and retained revisions. Saving wrote version 2
  while preserving BOM, CRLF and supported modes; the installed older CLI
  refused the new format without changing either Markdown or plain-text files.
- Native macOS, Windows CMD and Windows/WSL agents applied source and thread
  changes to the actual live buffer. Active, inactive, untitled and WSL-native
  documents retained one-step undo/redo, autosave behavior, exact line endings
  and Linux mode 0640.
- The sidebar passed reply, edit, reply deletion, resolve/reopen, filter counts,
  destructive confirmation and long-content layout checks. Human attribution
  used the local OS identity; literal markup remained text.
- Pending Unicode reply/edit text, focus and caret survived unrelated agent
  updates and buffer activation. Missing-target drafts remained copyable and
  two quit/relaunch cycles recovered both normal and missing-target composers.
  Deterministic interleaving tests cover composition becoming busy before an
  agent commit; this work unit makes no native IME input-method claim.
- No release was cut as part of this work unit.
