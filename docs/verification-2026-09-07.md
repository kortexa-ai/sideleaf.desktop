# Prototype verification — 7 September 2026

These are development-package observations, not release support or performance
promises. The tested toolchain is recorded in [prototype.md](prototype.md).

| System | Package and runtime checks | Interaction checks |
| --- | --- | --- |
| macOS 26.6.2 (25G83), Apple Silicon M4 Pro, 64 GB | Native WKWebView package; 12 tests; packaged Cottontail file smoke | Native Open/Save As, literal source/preview, Unicode paste and filenames, dead-key composition, comments, undo, external changes, save/reopen, large document |
| Windows 11 build 26200, x64, WebView2 152.0.4191.66 | Native WebView2 package; 11 tests and one POSIX-only skip; packaged Cottontail file smoke; editor creation and initial-document RPC followed by ready receipt in interactive Session 1 | Full keyboard, clipboard, native-dialog, screen-reader and IME walkthrough still needed |

The packaged-runtime smoke checks a Unicode path (`café-葉.md`), UTF-8 BOM and CRLF
byte preservation, atomic saves, comment reopen, external-write conflict rejection,
invalid UTF-8 rejection, and Save As. It runs with the shipped Cottontail binary,
not only Node. See `scripts/runtime-smoke.ts`.

On macOS, the real UI checks included moving a comment's passage by inserting text
before it, deleting the passage to make its comment unanchored, then undoing to
restore the passage and anchor. A clean external edit reloaded. A conflicting
external edit left the unsaved draft intact and refused a normal save. A native
Save As preserved the exact Unicode source and sidecar. An unfinished comment
remained visible when New was requested.

The large fixture contained 10,000 repeated Markdown sections. After a prefix edit,
its 678,926 saved bytes matched the expected complete file. The split view limited
preview rendering to 200,000 characters and retained the full editable source.

## Measurements

Measurements used a development build and warm OS caches. They are a baseline for
the next optimization work, not a passed low-memory gate.

| Observation | Result |
| --- | --- |
| macOS development bundle, disk usage | About 75.6 MiB |
| Windows development package, file bytes | About 80.8 MiB |
| macOS fresh process launch to editor ready | 1.83 s, observed with 200 ms polling; not a cold-cache launch |
| Windows host initialization to editor ready | 1.13 s after the native IPC fix; excludes launcher/runtime import time |
| macOS empty Sideleaf, full process group physical footprint | 468.8 MiB |
| macOS large fixture, Sideleaf split view physical footprint | 528.3 MiB |

macOS memory was measured with `/usr/bin/footprint --noCategories`, including the
Sideleaf launcher, Cottontail, WebContent, GPU and Networking processes. It is not
the Cottontail RSS alone. The stack has not yet met the low-memory aim. A cold-cache
launch, typing-latency distribution, and Windows memory baseline also remain to be
measured.

## Windows startup diagnosis

An SSH launch ran in non-interactive Session 0 and failed WebView2 window creation.
The actual test ran in the user's interactive desktop through a Sideleaf-only,
one-off scheduled task. It used a dedicated Windows checkout and a repository-local
Windows Node toolchain, with no global PATH or unrelated applications changes.

WebView2 then created CodeMirror but the framework's open loopback socket did not
deliver renderer requests. Switching Windows to Electroview's native IPC path
produced the host's initial-document receipt and the renderer's ready receipt.
The content policy also permits bundled stylesheet fetches needed by the framework.

Full CJK composition, accessibility, clean-machine WebView2 installation, autosave
recovery, file associations, signing/notarization and distribution remain later
acceptance work.
