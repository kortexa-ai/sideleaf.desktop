# Sideleaf

A small desktop Markdown editor for your words and your files.

Sideleaf uses Electrobun, Cottontail, CodeMirror 6, and the operating system's webview.
It is an independent implementation with its own product and document boundaries.

Sideleaf 0.1 supports Markdown files and folders, native Open and Save As,
literal source editing, live preview, find/replace, and anchored comments with undo.
Comments and retained revision metadata are embedded in the Markdown file; copy the
`.md` file to carry them with your writing. Existing comment sidecars migrate on save.
The [agent CLI](docs/cli.md) reads and edits documents/comments without a running GUI.
Install it from the Sideleaf menu (or Windows Setup); it uses the bundled Cottontail
runtime and needs no separate Node, Bun, or npm installation.
`sideleaf skills install` adds a small self-contained skill that teaches supported
agents the safe read, edit, and comment workflow.
Sideleaf registers as a Markdown editor with both operating systems, offers a
distraction-free full-screen workspace, and scales editor and preview text together.

## Files and folders

Choose **Folder… / Open Folder…** to browse a folder and its nested Markdown and
text files. Folders expand as needed; opening a folder does not load every file.
Click a file to edit it. Switching between open documents preserves unsaved text,
comments, undo history and position. **Open documents** also keeps untitled and
outside-folder files within reach; its × buttons close individual documents.

The folder icon beside Comments shows or hides the sidebar: **⌘⇧F** on macOS or
**Ctrl+Alt+F** on Windows. Opening a folder shows it initially; opening a single
file hides it initially and uses that file's containing folder when shown.
New inside a folder keeps the workspace and starts Save As in the selected folder.
A standalone new document has no folder to show until saved. Hiding the sidebar
keeps the workspace open; **File → Close Folder** closes it with unsaved-change checks.

Right-click a file or open-document name to rename it or move it to Trash / the
Recycle Bin. Folder creation and folder rename/move are not included. The tree
shows supported text files, omits dot entries and internal directories, and does
not follow links or junctions. Open a linked target directly when needed.

## Download

Get [Sideleaf 0.1.5](https://github.com/kortexa-ai/sideleaf.desktop/releases/tag/v0.1.5)
for Apple Silicon Macs running macOS 26.6.2 or later, or Windows 11 x64.
The Mac DMG is signed and notarized. The Windows setup ZIP is unsigned; extract
the ZIP, then run the setup executable.
Windows also needs Microsoft's WebView2 Evergreen runtime.

Your documents stay on your computer. There are no accounts or writing uploads.
Sideleaf checks GitHub for a newer stable version once a day and shows a small,
dismissible notice. Help → Check for Updates on macOS, or the hamburger menu on Windows, checks on demand. Updates open the
release page and install only when you choose to install them.
See the [privacy policy](https://sideleaf.xyz/privacy/) and
[terms](https://sideleaf.xyz/terms/) for details.

## Run and build

Use [Bun](https://bun.com/docs/installation) 1.4.0 or newer. On macOS, install the
Xcode command-line tools for the small native Save-panel adapter. On Windows, use native Windows Bun and the
installed Microsoft Edge WebView2 Evergreen runtime. Windows PowerShell supplies the
native Save picker.

```sh
bun install --frozen-lockfile
bun run prepare:devkit
bun run validate
bun start
```

`bun run build` produces a development package in `build/dev-macos-arm64/` or
`build/dev-win-x64/` on the corresponding machine. Launch the packaged app directly;
no browser development server is needed. Builds use the exact Electrobun version in
`hutch.config.ts` and `bun.lock`. `bunfig.toml` runs package CLIs with Bun, including
the Electrobun bootstrap;
Hutch manages the pinned devkit and Cottontail runtime. No separate Node or npm
installation is required for development. The current target is Apple Silicon macOS
and x64 Windows; other OS/architecture combinations need separate acceptance tests.

Use `bun run dev` to rebuild and relaunch the app when the TypeScript UI or host
changes. Electrobun bundles both directly; Sideleaf separately prepares only the
installed CLI and the small platform-native helpers.

On Windows, use `bun run build` and the packaged `bin/launcher.exe` for normal use
and performance checks. Packaging adds a small native adapter for the pinned
runtime's idle-CPU issue. Its first build downloads a checksum-verified Zig compiler
under `tmp/toolchain`; this build tool is not distributed with the app. The direct
`bun start` / Electrobun development path does not apply this adapter.

The app icon is original fal.ai artwork. Its source and generation prompt are in
`assets/`; `bun run build:icons` regenerates platform-size images from that source.
No image API key or image generation service is used at app runtime.

## Early release boundaries

- UTF-8 (with or without BOM), consistent LF or CRLF, files up to 10 MiB. Unsupported
  encodings and mixed line endings are rejected without changing the file.
- Autosave runs every 30 seconds by default for all edited named documents,
  including inactive buffers. Keep unsaved draft stores separate private recovery
  copies every five seconds, independently of autosave. Recovered named drafts
  open as untitled copies with their original path shown; they never overwrite
  the original automatically. Both behaviors have simple settings. Closing a dirty document offers Save,
  Discard, or Cancel, and external changes show Save a copy and Reload options.
- Markdown preview supports common Markdown and tables. Raw HTML and image loading
  are disabled. Only HTTP, HTTPS, and email links open externally. The preview shows
  the first 200,000 characters of large files; the complete source remains editable.
- Comments participate in undo/redo. Editing their selected text makes them visibly
  unanchored; undo restores the prior anchor. Sideleaf metadata uses its own versioned,
  documented format.
- Up to 64 documents can stay open; reaching the limit asks you to close one
  without discarding other buffers. Directory listings stop after 10,000 entries.
  Rename requires filesystem hard-link support; for a case-only change on a
  case-insensitive filesystem, use an intermediate name. Save legacy sidecar
  documents once before rename or Trash. Trash is unavailable for network/WSL paths.
- Tabs, multiple folder roots, full workspace session restoration, advanced review, and full
  accessibility/IME acceptance remain later work.

See [PLAN.md](PLAN.md) for product direction and [prototype decisions](docs/prototype.md)
for file safety, runtime boundaries, and platform details. Execution and validation
evidence is recorded in the [first verification](docs/verification-2026-09-07.md)
and the [size, speed and Windows follow-up](docs/performance-2026-09-07.md).
An earlier controlled empty-app measurement was about 321 MiB across the host
and webview processes; memory remains a limitation under active investigation.
The packaged Windows app includes an
[idle-CPU fix and measured verification](docs/windows-runtime-2026-09-07.md).
`bun run bench:editor` repeats the isolated editing benchmark.

The website is [sideleaf.xyz](https://sideleaf.xyz). Sideleaf's own source is
[MIT-licensed](LICENSE); dependencies retain their
[third-party licenses](THIRD_PARTY_NOTICES.md). See the
[release guide](docs/releasing.md) for native builds, signing and validation.
