# Size, editing cost and Windows verification — 7 September 2026

These measurements use development packages with Electrobun 2.0.2-beta.15,
Cottontail 0.6.0-canary.14, system WKWebView/WebView2, and Node 26.8.1 for the
isolated editor benchmark. The baseline is prototype commit `f671c3a`.
The implementation is tracked in [issue 3](https://github.com/kortexa-ai/sideleaf.desktop/issues/3).

## Changes

- Comment mapping reads the affected anchor ranges rather than copying the whole
  document on every edit. Unchanged anchors retain their identity.
- Word count follows the changed ranges, with Unicode, split/join, multi-change,
  undo and redo checks. Preview reads at most 200,000 characters. Write mode defers
  preview work until the reader is shown again. Comment-only changes do not reparse
  Markdown.
- Save uploads use ordered 256,000-character chunks. A native Windows 9 MB test
  exposed the runtime's 8 MiB CString limit on individual messages. Each chunk stays
  below that limit even after JSON escaping. Incomplete or invalid transfers cannot
  commit a file. Save returns document metadata, without echoing source and comments. The renderer also releases the initial full-document snapshot.
- The host bundle is minified. Windows' Save helper loads its subprocess module on
  demand. The package omits unused HTTP, TLS and V8 split runtime packs.
- Windows document shortcuts are handled in WebView2. Native dialog requests use
  the SDK's per-request infinite timeout; a person choosing a file does not cause
  the renderer to abandon a Save that the host may still complete.
- The gutter no longer adds a second 24-pixel top offset. CodeMirror positions its
  line numbers using the content padding, including wrapped lines and placeholders.

The trim script checks the exact SDK versions and permitted host imports. The
transitive file, crypto, IPC, subprocess and FFI paths were checked against
Cottontail revision `e5ddf52648c502b1b124ec5f41a9b87b7b9ecedb`. Stream, net, tty and
other required packs remain. Review the list when changing the runtime or host
imports. This is a development-package step; future signed release packaging must
run it before sealing/signing the bundle.

## Measurements

macOS: M4 Pro, 64 GB, macOS 26.6.2. File totals exclude symlinks and count actual
file bytes, rather than allocated filesystem blocks.

| Measurement | Prototype | Updated |
| --- | ---: | ---: |
| macOS package | 79,192,968 bytes (75.52 MiB) | 76,439,425 bytes (72.90 MiB) |
| Windows package | 84,720,284 bytes (80.80 MiB) | 81,947,753 bytes (78.15 MiB) |
| Host JavaScript bundle | 216,980 bytes | 138,023 bytes |
| macOS empty app, physical footprint after 180 seconds | 327.3 MiB | 321.3 MiB |
| 9 MB editor-state prefix edit, median | 14.199 ms | 0.007 ms |
| 9 MB editor-state prefix edit, p95 | 30.779 ms | 0.015–0.017 ms |
| 9 MB preview parsing plus word count | 82.518 ms | 12–13 ms |

The editing benchmark performs 60 prefix edits with CodeMirror history and comment
state. The updated run also maintains the incremental word-count field. The
fixture is repeated Markdown paragraphs, with no comments. These times measure
state transactions and parsing, **not native keyboard-to-paint latency**. Run
`npm run bench:editor` to repeat it. The same 9 MB benchmark on Windows measured
0.021 ms median, 0.067 ms p95 and 24.2 ms preview plus count. A 700 KB fixture also
runs; all reported word counts are checked against a full independent count.

The macOS physical-footprint pair includes the launcher, Cottontail, WebContent,
GPU and Networking processes, with WebKit ownership checked through launchctl.
Both runs used a fresh empty Split view and the same 180-second settling period.
The roughly 6 MiB difference is small and is only one paired observation. It must
not be compared directly to the earlier 469 MiB reading, taken at a different
settling time. There is no established cold-launch improvement or low-memory gate
pass. The 57.3 MiB static Cottontail/JSC executable still dominates installed size.

## Verification and remaining limits

`npm run validate` passes 16 tests on macOS and 15 on Windows, with the POSIX
symlink test skipped on Windows. Both trimmed packages pass the Cottontail runtime
smoke for Unicode filenames, UTF-8 BOM/CRLF preservation, atomic saves, comment
reopen, external conflict rejection, invalid encoding rejection and Save As.

macOS native checks cover placeholder, blank-line and wrapped-line number
alignment; Unicode paste and filename Save As; exact saved source bytes; and
Write-mode editing followed by a refreshed Split preview and normal Save.

Windows tests use native UI Automation in interactive Session 1 over the user's
SSH connection. The driver accepts windows and controls only from this checkout's
Sideleaf process and its descendants. It checks focus before sending input and
restores the clipboard after pasting. Dialogs are awaited as asynchronous UI
operations. The checkout, toolchain, tasks and fixtures are separate from
unrelated applications. Native keyboard-to-paint latency, CJK IME sessions, screen-reader
acceptance, clean-machine installation, signing and distribution remain untested.

Windows native checks also passed Open and Save shortcuts, Unicode clipboard input,
exact BOM/CRLF source preservation, comment save/reopen, undo/redo through saved
state, and deletion/undo of an anchored passage. A 9,000,000-byte fixture was edited
and saved as exactly 9,000,012 expected bytes through the chunked bridge, with a
200,000-character preview and the correct full-document word count.

An additional Windows idle check found substantial host CPU consumption: 9.94 CPU
seconds over 10 wall-clock seconds in the empty app. An isolated shipped-runtime
process containing only a 25-second timer used 4.72 CPU seconds during seconds
10–20, so this is not solely editor or preview work. This is tracked in [issue 4](https://github.com/kortexa-ai/sideleaf.desktop/issues/4);
Windows idle efficiency has not passed.

Clean external changes reloaded in the Windows UI. With an unsaved draft, a second
external write showed the conflict banner; normal Save refused it. Native Save As
to `windows-copy-café-葉.md` preserved the draft and comments while leaving the
external writer's original intact. The saved bytes were checked independently.

The final Windows Save As check kept its native dialog open for 199 seconds before
confirmation and then saved successfully. Both the ASCII and Unicode paths were
verified. Final builds include the bounded Save protocol on both operating systems.
