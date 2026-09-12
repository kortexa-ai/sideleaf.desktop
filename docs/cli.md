# Command line tool

Sideleaf includes its command-line tool and Cottontail runtime. End users do not
need Node, Bun, npm, or a running desktop window.

- **macOS:** choose **Sideleaf → Install Command Line Tool…**. Sideleaf creates
  `/usr/local/bin/sideleaf`, linked to the command inside the app. macOS asks for
  administrator authorization only if that directory is not writable. Keep the app
  in Applications; moving it requires rerunning the menu command. An unrelated
  existing command is never overwritten.
- **Windows:** select **Install the sideleaf command-line tool** in Setup, or choose
  **Sideleaf → Install Command Line Tool…** later. Both add the app's `bin` directory
  to the current user's PATH. Open a new terminal afterward. Windows uninstall removes
  that exact PATH entry and its installed files; no administrator account is required.
- **WSL:** Windows shows **Install Command Line Tool in WSL…** only when WSL has an
  available default distribution. It confirms the distro name and installs there only.
  Setup never modifies WSL. The wrapper uses the Windows app's bundled runtime through
  WSL interoperability, translating document and input-file paths. No Linux JS runtime
  is needed. Linux filesystem tools preserve private staging and file permissions
  when saving WSL-native files. After changing the default distro, run the menu command again to install
  there. WSL interoperability must be enabled.

The command follows desktop updates because it runs from the installed app.
`sideleaf --help` describes commands. JSON output escapes non-ASCII characters so
legacy Windows code pages cannot corrupt text.

## Install the agent skill

The bundled Sideleaf skill tells supported agents how to use the local CLI for
revision-safe Markdown and plain-text edits and comments. It is self-contained and does not use
the network.

```sh
# Shared agent location only:
sideleaf skills install

# Every supported user location:
sideleaf skills install --user

# One location: agents, claude, codex, omp, hermes, or pi
sideleaf skills install --target codex
```

The default path is `~/.agents/skills/sideleaf/SKILL.md`. `--user` also installs
under `~/.claude/skills`, `~/.codex/skills`, `~/.omp/skills`,
`~/.hermes/skills`, and `~/.pi/agent/skills`. In WSL, these paths use the WSL
home, not the Windows profile. Native Windows installs use the Windows profile.

Reinstalling an unchanged skill is a no-op. If the installed file has local
changes, Sideleaf leaves it alone and reports the path. Review your copy, then run
the same command with `--force` only when you want the bundled version to replace
it. Each changed `SKILL.md` is staged beside its destination and replaced
atomically.

The skill describes portable review threads and their revision guards. It also
documents the legacy comment commands, which continue to address thread roots for
older integrations.

On macOS, remove the command link before removing the app: `sudo rm /usr/local/bin/sideleaf`.
In each WSL distro where you installed it, `sudo rm /usr/local/bin/sideleaf` removes the
wrapper. Windows uninstall does not start or modify any WSL distro. A retained WSL
wrapper reports that the app is missing instead of running a stale copied CLI.

```sh
sideleaf read 'notes café.md' > snapshot.json
# Whole-document edits and new threads use the document revision:
sideleaf edit 'notes café.md' --if-revision HASH --actor agent:reviewer <<'JSON'
{"from":0,"to":0,"text":"# Notes\n\n"}
JSON
sideleaf thread-add 'notes café.md' --if-revision NEW_HASH --actor agent:reviewer <<'JSON'
{"from":2,"to":7,"body":"Keep this heading"}
JSON
sideleaf threads 'notes café.md' > threads.json
# Existing-thread writes use that thread's semantic revision:
sideleaf thread-reply 'notes café.md' --if-thread-revision THREAD_HASH --actor agent:reviewer <<'JSON'
{"threadId":"THREAD_ID","body":"I checked it."}
JSON
sideleaf thread-resolve 'notes café.md' --if-thread-revision NEW_THREAD_HASH --actor agent:reviewer <<'JSON'
{"threadId":"THREAD_ID"}
JSON
```

`--input PATH` supplies the same JSON without shell redirection (useful in
PowerShell). Read operations are deterministic for unchanged disk bytes. A write
returns a receipt with the new document revision and saved/live state. `read`
includes the visible text, `threads`, a root-only compatibility `comments` view,
and retained revisions. `threads` returns each thread with a semantic `revision`
computed from its state, messages, and attribution; anchor relocation and unrelated
source edits do not change that value. Generated IDs and timestamps record each
operation. CLI writes retain actor attribution in embedded revision metadata,
including text-only edits. Plain GUI documents remain plain until annotated.
Offsets are zero-based, end-exclusive UTF-16 code units in logical-LF source.
Metadata is excluded. Edits cannot split surrogate pairs. Actor names provide
attribution, without authentication.

`thread-message-update` and `thread-message-delete` accept `threadId` and
`messageId`; delete refuses the root message. `thread-reopen` and `thread-delete`
accept `threadId`. Replies added to a resolved thread retain its resolved state until
an explicit reopen. Existing-thread commands may also include `--if-revision` when
both the thread and entire document must remain unchanged. Generic `apply` accepts
the same operation objects. A `replace` or `thread-add` requires `--if-revision`;
all other thread operations require `--if-thread-revision`.

Legacy `comment-add`, `comment-update`, and `comment-remove` remain available for
root-message clients. Updating a root preserves replies and retained history.
Removing a root with replies is refused; use explicit `thread-delete` with its
semantic revision when deletion of the entire discussion is intended.

Exit codes: 0 success; 2 invalid usage/input; 3 stale revision or another Sideleaf
writer's lock; 1 filesystem/runtime failure. Errors are JSON on stderr. Reread after
a conflict; do not blindly retry with a new hash. Desktop and CLI share a per-document exclusive
lock and atomic replacement. Clean GUI documents reload CLI changes; dirty documents
retain their draft and show a conflict. An abandoned `.sideleaf.lock` is not stolen:
check its recorded PID and ensure all writers stopped before manually removing it.
Uncooperative editors can still race the final filesystem rename.

`sideleaf` starts Sideleaf or activates its existing window. `sideleaf FILE` is
shorthand for `sideleaf open FILE`; both open the requested document in the existing
window when Sideleaf is running. macOS uses the canonical bundle identifier and a
Launch Services file operand; `--app /path/Sideleaf.app` selects a particular build.
On Windows use
`--app 'C:\path\to\Sideleaf\bin\launcher.exe'` if automatic discovery fails.
Paths with spaces/Unicode are passed as arguments, never evaluated as shell code.
In WSL, the wrapper translates relative paths, `/mnt/...` paths and native Linux
paths into Windows drive/UNC paths. Windows drive paths are also accepted. Pipes
and `--input` work; `sideleaf open FILE` finds the installed Windows app automatically.
This requires WSL interoperability and Windows access to the current distro.

`sideleaf open-folder DIRECTORY` opens a folder workspace with the sidebar visible.
It accepts the same `--app` override and Windows/WSL path handling as `open`.
The command requires a directory; `open` continues to require a file. Files in
the folder load only when selected in the desktop tree. Running-instance opens use
the same Save, Cancel and Discard flow as File → Open when they replace the current
standalone document or folder. Opening another file in an existing folder workspace
adds or activates its tab without asking to discard unrelated dirty tabs. A successful
delivery result means the host accepted the request; the user can still cancel a
queued replacement in the desktop. A live app channel that does not answer produces
an error instead of starting a second instance. On macOS, `--app` is required when an
automation must distinguish dev from stable; without it, Launch Services can activate
an already-running build that shares Sideleaf's bundle identifier.

## Live document foundation

`sideleaf documents` lists every buffer in the selected running app, including the
active state, dirty state, path (or `null` for untitled work), document ID, live
revision and saved revision. `sideleaf read FILE` reads that live buffer when Sideleaf
owns it and otherwise reads the current saved disk snapshot.
Use `sideleaf read --document ID` for untitled buffers and whenever an exact live
identity is preferable to a path.

Collaboration operations include a guarded UTF-16 replacement:

```sh
sideleaf read --document DOCUMENT_ID > snapshot.json
sideleaf apply --document DOCUMENT_ID \
  --if-revision LIVE_REVISION --actor agent:reviewer <<'JSON'
{"operations":[{"kind":"replace","from":0,"to":0,"text":"# Review\n\n"}]}
JSON
```

Every operation is evaluated against the current live generation immediately before
one editor transaction. It is one undo step, preserves the editor selection mapping,
works for active and inactive buffers, and never activates another tab. Composition,
save-in-progress, closing, stale document or thread revision, timeout and uncertain
transport outcomes reject without leaving a queued write. Text replacement is limited
to 8,000 logical-LF characters so the request stays within the local channel's bounded
frame. Thread add, reply, message update/delete, resolve/reopen, and explicit thread
delete use the same live transaction route.

Receipts distinguish `live`, `saved` and `dirty`. With autosave off, a successful live
apply remains in the recoverable dirty buffer and leaves disk unchanged. With autosave
on, it follows the same delayed save path as human typing. An unowned named file uses
the same evaluator under `.sideleaf.lock`, rechecking live ownership after acquiring
the lock and saving atomically only when app absence is established. Offline reads stay
available in read-only directories because they do not mutate or lock the document.
Legacy `edit` and comment mutations reject an owned document with
`open in Sideleaf; use apply`.

`sideleaf wait FILE --after LIVE_REVISION --timeout SECONDS` is a silent one-shot
foundation wait. It returns immediately with `resync` if the live revision already
changed, returns `app-closed` when the app closes, or returns `timeout`; it writes no
idle output. Semantic thread revisions are returned by `threads`; activity cursors
and event filtering remain separate work.

Live failures use exit 4 and include a stable reason plus `retryable` and `requestId`
when reconciliation is required. A request that crossed the authenticated endpoint
but lost its receipt never falls back to disk. Reread the exact target before deciding
whether to retry that operation.

The installed desktop app also registers `md`, `markdown`, and `mdown` as
editable Markdown document types, and `txt` as plain text. Finder's Open With menu and Windows Default
Apps can therefore select Sideleaf, while the final default remains the user's
choice. OS-opened documents use the same unsaved-change confirmation as the
app's Open command.
