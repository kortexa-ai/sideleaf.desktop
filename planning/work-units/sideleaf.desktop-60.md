# Sideleaf 60 — live ownership and local transport foundation

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/60>
Program design: [sideleaf.desktop-59.md](sideleaf.desktop-59.md)
Launch prerequisite: [sideleaf.desktop-36.md](sideleaf.desktop-36.md)

## Implemented gate

This slice proves one live-document path without adding the thread, suggestion or
general batch surfaces assigned to later work units.

- The app publishes its channel before loading a document. Every app file load takes
  the canonical per-file `.sideleaf.lock`, loads and registers ownership, then
  releases it. Lock waits are asynchronous and bounded.
- A CLI read or write queries ownership without taking that lock. An offline write
  then takes the lock and repeats discovery and ownership before mutating the file.
  An offline read stays read-only and returns the saved disk snapshot.
  A live, unknown, incompatible, hung or closing endpoint fails closed. Only an
  established absent owner permits disk fallback.
- The private macOS Unix socket record binds protocol, process and random app instance.
  The client checks the private directory, socket type, owner and mode before sending
  the bearer value or document path, then checks the endpoint greeting. Abandoned
  sockets in the app's private namespace are removed only after the new app owns the
  single-instance lock.
- Local requests have bounded frames, deadlines and UUIDs. Small completed requests
  are deduplicated during that app session. Large reads use ordered bounded response
  chunks. A lost result after authenticated command delivery is reported as uncertain
  with the request ID and never triggers an offline retry.
- `documents` and `read` expose actual renderer buffers by canonical path or exact
  document ID, including active, inactive, dirty and untitled state. The host keeps no
  mirrored editable document.
- `apply` accepts exactly one whole-revision-guarded offset replacement in this gate.
  Active and inactive buffers use the same pure evaluator and one isolated CodeMirror
  transaction. Selection mapping, comments, undo/redo, recovery, conflict checks and
  the existing autosave setting remain on the editor's normal path. Composition and
  save-in-progress return retryable BUSY; expired work cannot apply later.
- Receipts distinguish live application from disk persistence. Existing mutation
  commands cannot bypass a live owner. The foundation `wait` is silent until resync,
  app closure or timeout; semantic activity cursors remain in the next work unit.

## Validation gate

Focused tests cover coherent lock-held disk updates, simultaneous app open, stale and
hung endpoint behavior, uncertain completion, request deduplication, large live reads,
active/inactive targeting, legacy mutation refusal, Unicode ranges, one editor undo,
selection and comment mapping, and the installed WSL wrapper's operand routing.

Native macOS acceptance must additionally exercise the packaged CLI without Bun or
Node on PATH, unsaved active and inactive reads, live apply with autosave off and on,
actual undo/redo, stale revisions, quiet wait completion, app close/cancellation,
concurrent open/write handoff, paths with spaces and Unicode, and access rejection from
a second local account.

Native Windows acceptance is pending because Scrappy is unavailable. When it returns,
use the exact candidate SHA and rebuild with Windows Bun, then test the visible app from
CMD and the installed WSL wrapper against both Windows-drive and WSL-native documents.
Cover spaces/Unicode, relative and aliased paths, inactive/untitled buffers, autosave,
undo/redo, concurrent open/write/close, stale PID and endpoint identity, hung renderer,
Ctrl+C cancellation, request reconciliation, and named-pipe access/impersonation from
a second local account. The Windows named-pipe transport remains provisional until
that OS-user boundary is proven or replaced with a small native adapter.
