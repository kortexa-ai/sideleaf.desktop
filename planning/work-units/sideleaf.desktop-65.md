# Sideleaf #65 — v0.1.8 release

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/65>

## Release contract

- Tag one fully validated `main` revision as `v0.1.8`.
- Build the Apple Silicon macOS distribution with Developer ID signing, app and
  DMG notarization, stapling and Gatekeeper verification.
- Build the native Windows x64 setup ZIP, retain its documented unsigned status,
  and verify installer and launcher metadata.
- Validate the packaged CLI and Cottontail runtime/workspace behavior on both
  native platforms, then install and exercise the real distributions.
- Publish both installers, combined SHA-256 checksums, third-party notices and
  required source archives on one stable GitHub release. Verify the public asset
  inventory and anonymous downloads before updating the website.

## User-facing highlights

- Saved review threads and guarded suggestions retain stable IDs, authors,
  decisions, anchors and history inside Markdown or text files. Unfinished reply
  and edit composers remain in private local recovery until submitted.
- The command-line tool delivers opens to the running app and targets exact live
  active, inactive or untitled editor buffers without bypassing ownership.
- Atomic guarded batches, bounded focus reads and quiet semantic waits support a
  human-and-agent collaboration loop while preserving one editor undo transaction.
- Current-user local transport, document handoff, Windows/WSL cancellation and
  reload activity are fail-closed across supported native paths.
- The bundled agent skill documents safe revisions, suggestions, recovered-copy
  discovery and background completion without timer polling.

## Validation gate

- Run the full pinned suite and release build on native macOS and Windows from the
  same commit. Exercise packaged CLI, runtime and workspace smoke with no external
  JavaScript runtime on the child `PATH`.
- Verify macOS nested signatures, hardened runtime, notarization tickets, staples,
  Gatekeeper and minimum-OS metadata for the final app and DMG.
- Verify Windows setup contents, version and file-description metadata, expected
  unsigned signatures, CLI selection, install/upgrade/uninstall behavior and WSL.
- Preserve Unicode, BOM, CRLF and applicable Linux modes through installed-app
  editing, conflicts, comments, suggestions, live collaboration and recovery.

## Known boundary

#64 tracks an intermittent blank macOS window observed through the CUA application
launch path during development acceptance. The identical bundle launched normally
from its executable; the evidence does not establish Finder behavior or a general
failure rate. Signed-distribution installation QA reports whether it recurs. No #64
product change is part of this release.
