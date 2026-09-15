# One WSL write operation

Work: [desktop #52](https://github.com/kortexa-ai/sideleaf.desktop/issues/52).

An existing-file save uses one WSL permission read and one WSL write helper.
The second content conflict check reuses the first read's permission mode.
The write helper receives raw bytes over stdin and paths as positional arguments.
It exclusively opens a private staging file beside the destination, checks the
received byte count, applies the requested mode, syncs before rename, atomically
replaces the destination and syncs its directory before returning success.

Failure before rename preserves the original; failure after rename is surfaced
as an uncertain save. Staging collisions never remove an existing file. Existing
document locks, content checks and post-save verification remain in the caller.

Test Unicode and shell punctuation, BOM/CRLF bytes, modes, short input,
collisions, symlinks and failed sync/rename. Native Windows Bun and packaged
Cottontail must exercise a real WSL filesystem; Linux-only tests are insufficient.
