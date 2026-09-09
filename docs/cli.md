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

On macOS, remove the command link before removing the app: `sudo rm /usr/local/bin/sideleaf`.
In each WSL distro where you installed it, `sudo rm /usr/local/bin/sideleaf` removes the
wrapper. Windows uninstall does not start or modify any WSL distro. A retained WSL
wrapper reports that the app is missing instead of running a stale copied CLI.

```sh
sideleaf read 'notes café.md' > snapshot.json
# Read the revision field from snapshot.json and supply it for every write:
sideleaf edit 'notes café.md' --if-revision HASH --actor agent:reviewer <<'JSON'
{"from":0,"to":0,"text":"# Notes\n\n"}
JSON
sideleaf comment-add 'notes café.md' --if-revision NEW_HASH --actor agent:reviewer <<'JSON'
{"from":2,"to":7,"body":"Keep this heading"}
JSON
sideleaf comments 'notes café.md'
sideleaf comment-update 'notes café.md' --if-revision NEW_HASH --actor agent:reviewer <<'JSON'
{"id":"COMMENT_ID","body":"Updated thought"}
JSON
sideleaf comment-remove 'notes café.md' --if-revision NEW_HASH --actor agent:reviewer <<'JSON'
{"id":"COMMENT_ID"}
JSON
```

`--input PATH` supplies the same JSON without shell redirection (useful in
PowerShell). Read operations are deterministic for unchanged disk bytes. A write
returns the new revision, text and comments; generated IDs and timestamps record
that operation. CLI writes retain actor attribution in embedded revision metadata,
including text-only edits. Plain GUI documents remain plain until annotated. Offsets are zero-based, end-exclusive UTF-16 code units in source
with logical LF separators. Metadata is excluded. Edits cannot split surrogate
pairs. Actor names explicitly attribute writes and comments, without authentication.
Thread replies and resolve/reopen are not yet desktop features and remain deferred.

Exit codes: 0 success; 2 invalid usage/input; 3 stale revision or another Sideleaf
writer's lock; 1 filesystem/runtime failure. Errors are JSON on stderr. Every write
requires the current whole-file revision, including comments. Reread after a conflict;
do not blindly retry with a new hash. Desktop and CLI share a per-document exclusive
lock and atomic replacement. Clean GUI documents reload CLI changes; dirty documents
retain their draft and show a conflict. An abandoned `.sideleaf.lock` is not stolen:
check its recorded PID and ensure all writers stopped before manually removing it.
Uncooperative editors can still race the final filesystem rename.

`sideleaf open FILE` opens a new desktop instance. macOS uses the canonical bundle
identifier; `--app /path/Sideleaf.app` selects a particular build. On Windows use
`--app 'C:\path\to\Sideleaf\bin\launcher.exe'` if automatic discovery fails.
Paths with spaces/Unicode are passed as arguments, never evaluated as shell code.
In WSL, the wrapper translates relative paths, `/mnt/...` paths and native Linux
paths into Windows drive/UNC paths. Windows drive paths are also accepted. Pipes
and `--input` work; `sideleaf open FILE` finds the installed Windows app automatically.
This requires WSL interoperability and Windows access to the current distro.

The installed desktop app also registers `md`, `markdown`, and `mdown` as
editable Markdown document types. Finder's Open With menu and Windows Default
Apps can therefore select Sideleaf, while the final default remains the user's
choice. OS-opened documents use the same unsaved-change confirmation as the
app's Open command.
