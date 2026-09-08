# Prototype decisions

The first implementation targets Apple Silicon macOS and x64 Windows together, as
requested during implementation. Electrobun is pinned to `2.0.2-beta.15`; its devkit
pins application Cottontail to `0.6.0-canary.14` and the npm bootstrap pins Hutch to
`0.26.0-canary.10`. The main process uses narrow Electrobun API entry points. The
single webview uses bundled DOM/CSS/JavaScript, CodeMirror 6, and markdown-it 15.0.1.
No Warren, Dawn, CEF, Node, or Bun runtime is bundled intentionally.

The [runtime ownership](https://framework.blackboard.sh/electrobun/guides/cottontail/)
and [platform guide](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)
describe the underlying framework. Sideleaf's tested support matrix is narrower than
the framework's advertised matrix. Record actual package tests before expanding it.

## Documents and comments

The editor represents source as Unicode with logical LF separators. Saving restores
the original LF/CRLF style and UTF-8 BOM. Markdown is never parsed and reserialized
for persistence. Mixed separators and invalid UTF-8 are explicitly unsupported.
All annotation offsets are UTF-16 code units in the logical editor document.

Each open document has a fresh host-issued ID. The webview can save only that opened
document; Save As obtains a path from a native picker. A SHA-256 fingerprint includes
both the source bytes and comment sidecar. It is checked before every save, and a
two-second poll detects external writes. Reload creates a history boundary. Saving
preserves undo history. Comment insertion/removal and anchor changes share the text
editor's history; they do not create a separate conflicting undo stack.

Comment sidecars use `sideleaf-comments`, version 1. Each revision records the hash
of the exact source bytes and its complete comment set. A save atomically replaces
the sidecar first with the new revision and the preceding source revision, then
atomically replaces the Markdown file. On reopen, the matching source hash selects
the appropriate comment set. This makes interruption between the two replacements
recoverable without embedding annotations in the user's Markdown. Invalid sidecars
are rejected, and unrelated destination annotations are never silently overwritten.

If an external source revision matches neither stored hash, reattachment requires
exact quotation and surrounding context at one location. Uncertain or deleted text
leaves an unanchored comment. The app retains its draft after save errors. Metadata
written before an unsuccessful source save can cause the next save to report a
conflict; save a copy or reload the matching prior revision rather than guessing.

Atomic replacement uses an exclusive temporary file in the target directory, flush,
rename, and directory flush where supported. Existing file mode is preserved. Opening
a symlink resolves its target; later replacement of that target with a link is refused.
Extended attributes, ACLs, hard-link identity, network-filesystem guarantees, and a
different process racing between the last check and rename need more work. This is
not an operating-system-wide compare-and-swap protocol.

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
