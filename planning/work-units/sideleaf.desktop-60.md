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
- Windows keeps its discovery record, bearer value and owner file in a
  current-user-only directory. Document requests and replies require the authenticated
  same-user channel. A small native bridge verifies the connected named-pipe server's
  PID, exact process creation time and user SID before forwarding any private material.
  If another local identity somehow learns the random pipe name, the
  runtime's default pipe ACL permits a read-only connection that receives only the
  nonsecret protocol greeting; it cannot create the first instance, open read/write,
  authenticate or receive document data. Unauthenticated connections time out after
  four seconds.
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

Native acceptance completed at
`8b38dfafc7f4c0e417382fa4f0896b69761c571a` on both platforms:

- macOS and Windows built with the pinned native toolchain. Their packaged CLIs ran
  without Bun or Node on `PATH`; the final suites passed 107/107 on macOS and
  104/104 with three platform skips on Windows.
- Visible desktop checks covered dirty active, inactive and untitled buffers;
  autosave off and on; stale revisions; legacy-mutation refusal; one-step native
  undo/redo; dirty open and close prompts; Unicode paths; exact BOM/CRLF and mode
  preservation; lock release; quiet timeout; and app-close wake-up.
- Native CMD and the production-equivalent WSL wrapper reached the same running
  Windows app. Windows-drive and WSL-native documents resolved to their live buffers
  by path and document ID. WSL foreground termination cancelled an established
  request promptly without leaving the bridge to wait for its deadline.
- The Windows helper verifies the connected pipe's server PID, exact process creation
  time and user SID before sending a bearer value or document data. A native test under
  the distinct `NT AUTHORITY\LOCAL SERVICE` SID proved that another local identity
  cannot list the private channel directory, read its endpoint record, squat the live
  pipe's first instance or open the pipe for read/write. It could receive only the
  public greeting over a read-only connection. The temporary task, output permission,
  server and fixtures were removed after the check.

The foundation does not claim semantic activity wakes, which remain assigned to the
next collaboration work unit.
