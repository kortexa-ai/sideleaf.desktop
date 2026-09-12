# Prototype decisions

The first implementation targets Apple Silicon macOS and x64 Windows together, as
requested during implementation. Electrobun is pinned to `2.0.2-beta.15`; its devkit
pins application Cottontail to `0.6.0-canary.14` and the Electrobun bootstrap (run
with Bun) pins Hutch to `0.26.0-canary.10`. The main process uses narrow Electrobun API entry points. The
single webview uses bundled DOM/CSS/JavaScript, CodeMirror 6, and markdown-it 15.0.1.
No Warren, Dawn, CEF, Node, or Bun runtime is bundled intentionally.

The [runtime ownership](https://framework.blackboard.sh/electrobun/guides/cottontail/)
and [platform guide](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)
describe the underlying framework. Sideleaf's tested support matrix is narrower than
the framework's advertised matrix. Record actual package tests before expanding it.

## Documents and review threads

The editor represents source as Unicode with logical LF separators. Saving restores
the original LF/CRLF style and UTF-8 BOM. Markdown is never parsed and reserialized
for persistence. Mixed separators and invalid UTF-8 are explicitly unsupported.
All annotation offsets are UTF-16 code units in the logical editor document.

Each open document has a host-issued session ID, retained through save, rename and
reload. The webview can save only an open session; each session has its own staged
transfer. Save As obtains a path from a native picker. A SHA-256 fingerprint includes
the complete file and any legacy comment sidecar. It is checked before every save, and a
two-second poll detects external writes. Reload creates a history boundary. Saving
preserves undo history. Thread operations and anchor changes share the text
editor's history; they do not create a separate conflicting undo stack.

Embedded metadata uses `sideleaf-comments`, version 3. The terminal envelope is
exactly two newlines, `<!-- sideleaf:metadata`, a newline, one JSON object, a newline,
`-->`, and a final newline. All envelope separators use the source file's LF/CRLF
style. The two leading newlines belong to the envelope, preserving source that has
no final newline. JSON escapes `<`, `>`, `&` and `-` as Unicode escapes to prevent
comment terminators. Metadata never enters the source editor or preview.

Source is limited to 10 MiB of UTF-8 and metadata to 10 MiB. Each of up to three
retained revisions contains SHA-256 of exact source bytes (including BOM and original
line endings), complete review threads, and optional actor/save timestamp. A thread
has one stable ID, an anchor, open/resolved state, resolution attribution, and ordered
messages with stable IDs and edit attribution. The root message deliberately shares
the thread ID. A thread may carry one version-1 suggestion containing its
pending/accepted/rejected state, exact original and replacement, full selector
context, and terminal decision attribution. These are review recovery revisions,
not full historical text. The
CLI's write precondition hash covers the complete on-disk document and any legacy
sidecar. New files without threads/history have no envelope; unchanged plain saves
preserve the file itself.

Embedded version-1 metadata migrates in memory to one open thread per comment,
preserving the comment ID as both thread and root-message ID, its anchor, attribution,
and retained history. Version-2 thread metadata retains its stable IDs, anchors,
messages and history. Unattributed legacy comments remain unattributed. The next
explicit save writes version 3, which older readers reject before changing the file.

Agent collaboration uses bounded focused reads and atomic batches over the same draft
model. A batch contains at most 64 sequential source or thread operations. Offset and
quote-addressed source changes compose into one CodeMirror transaction, so selection,
anchors, highlights and undo map through the complete batch. Exact quote selectors may
carry prefix/suffix context and must resolve to one complete UTF-16 range. Existing
thread operations compare semantic guards with the batch-start thread value.
Suggestions use the same evaluator. Creation records a unique exact quote and up to
256 UTF-16 code units of selector context without changing source. Accept revalidates
the pending state, attached anchor, stored selector and exact original immediately
before applying the replacement and terminal state in one transaction. Empty
replacements are deletions. Reject records only terminal state. Missing, changed,
orphaned and ambiguous targets refuse the complete batch.

Each live buffer has an in-memory semantic activity journal of at most 256 events and
a cursor scoped to the app instance and document. The cursor is captured with a read,
focus or commit, before any asynchronous transfer. Thread actions, their undo/redo and
agent source applies record events; ordinary source keystrokes do not. A gap, restart,
document close or unavailable retained cursor produces resync. Closing a buffer drops
its journal and wakes its waiters. Saved-file cursors use the complete disk revision;
offline waits poll stat identity before rereading and recheck live ownership during
the bounded wait.

Legacy sidecars remain readable, including the two-revision interrupted-save
recovery case. Saving embeds the selected comment set plus both retained revisions
in one atomic replacement. Only after exact readback succeeds is the sidecar renamed
to `filename.md.sideleaf.json.migrated-UUID`. Keep that backup for recovery. Save As
leaves the original sidecar untouched. If both formats exist, every legacy revision
must also exist identically in the envelope; otherwise opening fails and preserves
both for deliberate reconciliation. Invalid/unsupported blocks fail without rewriting.

If external source matches no stored hash, reattachment requires exact quotation and
surrounding context at one location. Uncertain/deleted text remains unanchored. Saves
retain the GUI draft on error. A per-document exclusive `.sideleaf.lock` serializes
cooperative GUI/CLI writers; stale locks require owner verification before removal.

Atomic replacement uses an exclusive temporary file in the target directory, flush,
rename, and directory flush where supported. Existing file mode is preserved. Opening
a symlink resolves its target; later replacement of that target with a link is refused.
Extended attributes, ACLs, hard-link identity, network-filesystem guarantees, and a
different process racing between the last check and rename need more work. This is
not an operating-system-wide compare-and-swap protocol.

## Folder workspaces and recovery

One host workspace owns a root, document registry and per-directory watchers.
The renderer keeps a CodeMirror EditorState per buffer and mounts one EditorView.
Selection, undo, review threads, pending root/reply/edit text, scroll and saved
baselines remain with the originating buffer. Saves use captured states and session IDs, including
background autosave; typing during transfer remains dirty. Dirty native window
state covers every buffer. Close Folder and Quit check all affected documents.

Folder listings enumerate one directory at a time, with a 10,000-entry limit.
Only supported text files and ordinary directories appear. Dot entries, internal
directories, links and junctions are omitted. Root and entry identities are checked
again when used; old-root requests, traversal and links outside the root fail.
The app retains up to 64 open buffers and refuses another open at the limit rather
than evicting edits or undo history.

Nonrecursive filesystem watchers cover up to 64 expanded directories. Visible
directories also refresh every ten seconds for WSL/network or unavailable watches.
Hiding the panel releases watches and stops directory refresh; open-document
conflict polling continues. Unchanged listings do not replace the tree DOM.
Renames reserve the destination with an exclusive hard link, preserve session
identity and check the saved disk revision. Unsupported hard-link filesystems fail
without substituting overwrite-prone rename. Existing names, including case-only
aliases, are refused. Trash uses the OS recovery mechanism and is disabled for
Windows network/WSL paths. Legacy sidecars must migrate through Save first.

With Keep unsaved draft enabled, each dirty buffer has its own private atomic
recovery record, checked every five seconds independently of autosave. Records
include original path/revision and unfinished root/reply/edit review text. Startup migrates the older
single untitled record only after writing its replacement. Recovered named content
opens as a separate untitled copy; recovery never replays it over an original.
Saving or discarding one document cannot clear another document's recovery record.
Corrupt records remain in place and do not hide valid records. Full workspace
session restoration (root, expansion and clean documents across app restarts) is
separate work.

## Native integration and preview

Electrobun supplies the main window, menu, clipboard behavior, and Open picker. Its
current SDK does not expose Save As. macOS uses a small Swift/AppKit dynamic library
that displays NSSavePanel in the existing app. Windows uses its built-in Windows
Forms SaveFileDialog through Windows PowerShell; paths are passed as environment
data, not interpolated into script code. These adapters choose a path only.

The pinned Windows runtime opens its loopback WebSocket but did not deliver the
editor's startup requests in the packaged test. The native IPC bridge did deliver
them. Sideleaf therefore uses Electroview's native transport on Windows and keeps
the default transport on macOS. Recheck this bounded override when updating the SDK.
Bundled resources also need `views:` in CSP `connect-src` because the framework
fetches stylesheets to inline them in WebView2.

The preview disables raw HTML, remote/local images, and non-web/non-email external
links. A restrictive content security policy guards the bundled UI. Markdown and
comment text are untrusted. No general shell, path-read, or command-execution method
is exposed through the typed bridge. Local image resolution, click-to-source mapping,
task interaction, and HTML compatibility need explicit future designs.

Preview rendering is debounced and limited to 200,000 characters; the complete file
up to 10 MiB remains editable and savable. No product speed or memory claim follows
from package size. Performance evidence must name the OS, runtime, fixture, app and
webview processes, and whether it is a cold or warm launch.

## Plain-text editing

Files ending in `.txt` (case-insensitive) use plain CodeMirror editing in Write
mode, with the Markdown view controls and Single line breaks setting hidden.
New starts as Markdown. Save As and Rename apply the destination type only on
success and preserve editor history; cancelled or failed operations keep the
existing type. Review threads and their embedded metadata remain available in text
files. Recovery copies of text files remain untitled text documents. The Mac
app and Windows installer advertise `.txt` in Open With and Default Apps.

macOS enables native spelling again when the renderer reports ready, because
the constructor flag alone can leave spelling disabled during startup. Spelling
marks use the operating system dictionary and do not enable autocorrection.
