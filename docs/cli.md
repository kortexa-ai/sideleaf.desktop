# Agent command

Build the installable archive with `npm pack`. Install it with
`npm install -g /absolute/path/sideleaf-desktop-0.1.1.tgz`. Node.js 24+ is required;
the CLI contains the shared document services and needs no running desktop app.
The archive is portable between macOS, native Windows and Linux/WSL.
`sideleaf --help` gives the complete command grammar. JSON is the default output.

On Windows, run `scripts/install-cli.ps1 -Package C:\path\sideleaf-desktop-0.1.1.tgz`.
It installs the native command, adds npm's command directory to your user PATH
if needed, and lists installed WSL distributions. Add `-Distribution Ubuntu`
(or an array of exact distribution names) to install into selected distributions.
Each needs its own Linux Node.js 24+ and npm. No WSL installation is required for
native use. Rerun the same setup after adding a distribution or updating Sideleaf.
Use `-Uninstall` with the same distributions to remove commands; npm's shared PATH
entry remains because other commands can use it. `npm uninstall -g sideleaf-desktop`
also works independently in each shell. npm replaces commands in place on upgrade.

On macOS/WSL, `sh scripts/install-cli.sh /path/to/archive.tgz` is equivalent to the
npm installation. Use a user-owned Node installation; elevated access is unnecessary.

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
that operation. Offsets are zero-based, end-exclusive UTF-16 code units in source
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
In WSL, document operations use Linux directly for both `/mnt/c/...` and native
Linux files; Windows drive paths are converted with `wslpath`. To open the Windows
GUI from WSL, use `--app /mnt/c/path/to/Sideleaf/bin/launcher.exe`. Drive and native
WSL document paths are converted to Windows drive/UNC paths in the current distro.
This requires WSL interoperability and access to that distro from Windows.
