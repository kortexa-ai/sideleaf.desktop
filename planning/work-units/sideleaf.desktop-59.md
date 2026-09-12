# Sideleaf document collaboration design

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/59>
Product direction: [PLAN.md](../../PLAN.md#live-document-collaboration)

This design defines the versioned collaboration contract, delivery sequence and acceptance gates. The scoped write guards below amend the whole-file revision policy for the new contract; existing headless commands retain their documented guards. Transport details remain provisional until the integrated native-app gate passes.

## Recommended approach

Use one document state while Sideleaf has a document open. The CLI reads and changes that state through a small local connection to the app. With no app running, the same document operations use the existing file service. Keep the app free of a model runtime, background collaboration service, database, and merge engine.

The existing WSL wrapper already invokes the Windows CLI/runtime. Preserve that route: CMD and WSL both become Windows clients of the Windows app. Do not add a Linux agent service, expose a Windows listener to the WSL network, or ask users to configure ports.

## Open documents and saves

- Reads return the current buffer, including unsaved edits. A compact document list identifies named, untitled, active, and inactive documents. Commands target an exact path or explicit document ID, never whichever tab happens to be active.
- One validated batch becomes one isolated undoable editor transaction. It preserves selection and does not activate another document. If the renderer is composing text, reject the apply with retryable BUSY; do not leave a delayed mutation queued. The same pure operation evaluator supplies the offline path.
- Evaluate every guard against the actual editor state immediately before dispatch. An open document has an opaque instance/document/generation revision; a saved revision is an exact disk-content hash. Do not keep a second editable host copy synchronized on every keystroke. The scoped guards below avoid rejecting a local passage edit merely because the human typed elsewhere.
- Read and write receipts distinguish live application from durable file persistence. Honor the existing autosave setting. With autosave off, an agent edit stays dirty and recoverable like a human edit; it must not silently save the human's unrelated draft changes. An explicit Save can save the whole named document through the normal save path. Untitled documents require the user's normal Save As choice.
- Keep existing disk conflict checks. Uncooperative external editors and stale agent requests can still conflict. Routing cooperating agents into the buffer removes the routine disk-versus-buffer collision; it does not make every conflict impossible.
- A busy, hung, closing, incompatible, or uncertain app must never trigger a silent fallback to writing its document on disk. Bound requests; expired queued writes cannot apply later. On an uncertain result, return its request identity and require reconciliation. In-session request deduplication is sufficient initially; do not invent an unbounded exactly-once journal.
- Use the existing canonical per-document `.sideleaf.lock` as the handoff arbiter, not a second coordination service. Publish the app endpoint before loading documents. App open takes the lock, loads and registers ownership before releasing it. An offline CLI write takes the same lock, re-discovers the endpoint and asks ownership again under that lock. If owned, release and route; otherwise complete the disk write while locked. The ownership query is a lock-free map lookup, and waiting for the document lock must not block the host event loop. App open retries a held lock asynchronously for a short bounded interval before reporting that another writer holds it. App wins means route to its buffer; CLI wins means the app loads the completed disk write. Updated cooperating clients must have no residual unchecked write window.
- Offline fallback requires established owner absence, not merely a refused connection. Discovery records bind process identity, instance and protocol; validate process reuse and stale discovery conservatively. A live or unknown owner, auth/version mismatch, timeout, closing app or failed listener returns an explicit error. Test discovery publication during startup and recheck, and canonical path identity through rename, Save As and close. Apply #47's deliberate lock-recovery rules; never silently steal an active lock.

## Local connection

The transport is `node:net`: a Unix socket on macOS and a named pipe on Windows, with one bounded message protocol. Keep discovery records, authentication tokens, owner files and all document traffic private to the OS user. Verify peer/endpoint identity and use a random per-instance endpoint name. Never send reusable secrets or document data to an unverified endpoint. Reject mismatched protocol/app instances and do not expose the renderer bridge or command execution. Prove the Windows boundary from a second local account, including pipe impersonation; chmod is not a Windows ACL. Use a small native adapter where the pinned runtime cannot establish the required boundary. Do not invent a cryptographic protocol to rescue the transport.

The Windows named pipe retains the default Windows DACL. Another local account can connect read-only and receive the bounded public greeting: contract, protocol version, instance ID and process ID. It contains no secret or document data; the instance ID and process ID are already discoverable from the pipe name and process list. Other accounts cannot read the private discovery record/token, create a pipe instance or connect with read/write access. Before sending authentication or document bytes, the client verifies the connected server's process ID, creation time and user SID and uses anonymous impersonation. Unauthenticated connections expire after four seconds. Sustained connections from another local account can still exhaust local resources; this accepted availability limit does not justify a separate native pipe server.

The host forwards open-buffer operations to the existing renderer. Reuse bounded/chunked transfers for large snapshots; the pinned runtime has an 8 MiB CString limit and Sideleaf already uses 256,000-character chunks. Renderer receipt, revision validation, and the transaction must describe the same state. Account for inactive buffers, IME composition, save-in-progress, close, rename, and Save As.

Transport choice is provisional until integrated native-app tests pass. A fallback transport may replace the small adapter; it must not introduce a second document authority.

## Agent efficiency

Add a batch operation interface with exact quote selection and optional disambiguating context. A missing or ambiguous match rejects the entire batch. Evaluate operations in order against a temporary draft, validate the complete result, and commit once. Quote selection removes UTF-16 calculation from normal agent use. The new contract replaces the blanket whole-file precondition with operation-scoped guards:

| Operation | Required guard |
| --- | --- |
| Passage replacement, suggestion or anchored comment | Exact unique quoted target plus any supplied context; missing or ambiguous rejects the batch |
| Reply, edit/delete message, resolve or reopen | Hash of the thread's semantic state, including message IDs, bodies, authors, edits/deletions and open/resolved state |
| Whole-body replacement or legacy offset-only edit | Whole-document revision |
| Accept a suggestion | Revalidate the anchored old text and the suggestion's current semantic state |
| Any batch with `ifRevision` | Additionally require the supplied whole-document revision |

Agents use the optional global guard when their reasoning depends on the whole snapshot. Offline operations also retain exact disk read/check/write conflict detection under the lock; scoped passage guards do not permit overwriting an intervening external write.

Return compact mutation receipts with revisions and created/changed IDs. Do not return the whole document or all retained history after each operation. Allow focused reads of a relevant passage or thread. Give the new response/guard contract an explicit version. Preserve the existing headless commands and outputs on unowned files. Legacy mutation commands against an owned document fail clearly with “open in Sideleaf; use apply”; they cannot bypass ownership. The new skill uses focused reads and apply. A typical receipt distinguishes `{live, saved, dirty}` and reports created/changed IDs without a document dump.

Provide one silent, blocking `wait` command, scoped to a thread or relevant human activity. It returns one bounded result and exits. Harness integration must use a verified background completion or notification facility to wake the agent once. It emits no idle status, heartbeat, document dumps, or per-keystroke events. Default events are new threads, replies, resolve/reopen and suggestion acceptance/rejection by another actor; filter by thread or mention. Own writes do not create an agent response loop. Distinguish event, timeout, app closure and resync outcomes. A continuous JSONL stream is optional for harnesses that actually support event-driven stream delivery.

Return a cursor with reads and writes so a response arriving before `wait` starts is still detected. Keep any live event buffer bounded; an expired cursor, app restart, or history gap requests a focused resync instead of pretending nothing happened. Offline observation may compare saved state inside the waiting process; internal filesystem checks cost no model tokens and must remain quiet. Semantic event history is not a permanent audit log.

Cancellation, app closure, and finite timeouts terminate cleanly. The installed skill uses actual supported harness background/monitor tools; it must not tell an agent to repeatedly check the task's status. No claim of automatic wakeup on a harness until it is exercised. If a harness cannot resume on completion, document that limit instead of adding a new agent daemon.

## Review workflow and file format

1. Implement #35's threads: existing comments migrate to one-message threads with preserved IDs and anchors; show author/time, reply, resolve/reopen, and filters. Actor labels remain attribution, not authentication.
2. Add suggestions after the shared live-operation path works. Creating a suggestion leaves source unchanged. Accept revalidates the anchored old text and applies the change plus thread state as one undoable transaction; stale or ambiguous targets cannot be applied silently. Reject leaves source unchanged. Use explicit actions/shortcuts that do not hijack normal Enter while typing a reply.
3. Agents use suggestions for review requests and direct edits when the user requested edits. Do not impose an approval ceremony on every authorized edit.
4. Keep portable embedded metadata and current recovery behavior during this work. Removing the revision ring, changing all IDs/timestamps, and introducing automatic three-way merge are separate decisions. Make the new CLI output compact. Any removal of unnecessary JSON escaping is a separate small cleanup with round-trip fixtures, not a reason to change the recovery format. Anchor relocation improvements must preserve explicit orphaning on uncertainty and must not authorize stale destructive edits.
5. Highlight exact ranges from a known applied transaction until the next human edit; do not build a post-reload diff engine. Show recent agent activity from actual session events, not old comments presented as a live connection.
6. Version thread/suggestion metadata explicitly. Preserve existing comment IDs, anchors and retained history in migration. Older unsupported builds must fail without overwriting the file; document that an update is required. Do not add a compatibility-shim release or a lossy downgrade writer.

## Delivery sequence

1. **Prove ownership and communication first.** A bounded native-app slice establishes transport, single-instance/open delivery (#36 and the relevant #47 item), live snapshot, one guarded undoable mutation, offline/app handoff, failure behavior, and a quiet wait's actual harness wakeup. If this fails, revise the design before building a disk-merge substitute.
2. **Ship the useful collaboration loop.** Shared batch operations, quote addressing, compact reads/receipts, threads (#35), and quiet cursor-based waiting. Include transaction highlights and truthful activity, honor autosave and preserve existing recovery. Threads may progress independently if transport stalls, but that is not integrated live collaboration.
3. **Add proposals.** Suggest/accept/reject on that same operation path, with restrained UI and explicit stale-target handling. Reader markers and richer change visualization can follow independently.

Do not bundle #47's unrelated quit and abandoned-lock UI work into this plan accidentally. Reuse its agreed recovery semantics where necessary and keep issue ownership clear. Deliver the foundation, collaboration loop and suggestions as separate work units through their acceptance gates.

## Acceptance matrix

Exercise macOS native app/CLI, Windows native app with a CMD agent, and Windows native app with a WSL agent. Cover Windows-drive and WSL-native files, relative paths, spaces, Unicode/emoji, BOM/CRLF and Linux file modes. Test real packaged commands without Node/Bun on PATH.

Across that matrix, cover clean and dirty documents; autosave on/off; inactive and untitled buffers; typing and IME during read/apply; stale and ambiguous matches; one-step undo/redo; app startup/open/close during an offline write; concurrent agents; rename/Save As; save failure and process loss; response-before-wait; repeated/self events; cursor gaps; app restart; Ctrl+C and parent cancellation without orphaned Windows children.

Measure an idle wait: zero model polling turns and zero stdout bytes until a relevant event, then one bounded result. Verify actual harness resume behavior separately from the CLI's OS support. Avoid claiming cross-platform acceptance from WSL-only tests or a standalone runtime probe.
