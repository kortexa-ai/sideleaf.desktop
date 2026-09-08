# Sideleaf

A small desktop Markdown editor for your words and your files.

Sideleaf uses Electrobun, Cottontail, CodeMirror 6, and the operating system's webview.
It is an independent implementation; Margin is a product reference only.

The first prototype supports a single Markdown document, native Open and Save As,
literal source editing, live preview, find/replace, and anchored comments with undo.
Comments are saved beside the document as `filename.md.sideleaf.json`. Keep the two
files together when moving an annotated document.

## Run and build

Use Node 24 or newer and npm. On macOS, install the Xcode command-line tools for the
small native Save-panel adapter. On Windows, use native Windows Node/npm and the
installed Microsoft Edge WebView2 Evergreen runtime. Windows PowerShell supplies the
native Save picker.

```sh
npm ci
npm run prepare:devkit
npm run validate
npm start
```

`npm run build` produces a development package in `build/dev-macos-arm64/` or
`build/dev-win-x64/` on the corresponding machine. Launch the packaged app directly;
no browser development server is needed. Builds use the exact Electrobun version in
`hutch.config.ts` and `package-lock.json`. The current target is Apple Silicon macOS
and x64 Windows; other OS/architecture combinations need separate acceptance tests.

On Windows, use `npm run build` and the packaged `bin/launcher.exe` for normal use
and performance checks. Packaging adds a small native adapter for the pinned
runtime's idle-CPU issue. Its first build downloads a checksum-verified Zig compiler
under `tmp/toolchain`; this build tool is not distributed with the app. The direct
`npm start` / Electrobun development path does not apply this adapter.

The app icon is original fal.ai artwork. Its source and generation prompt are in
`assets/`; `npm run build:icons` regenerates platform-size images from that source.
No image API key or image generation service is used at app runtime.

## Prototype boundaries

- UTF-8 (with or without BOM), consistent LF or CRLF, files up to 10 MiB. Unsupported
  encodings and mixed line endings are rejected without changing the file.
- Saves are explicit. Clean external changes reload; unsaved changes show a conflict
  with Save a copy and Reload options. There is no autosave or crash recovery for
  unsaved editor buffers yet.
- Markdown preview supports common Markdown and tables. Raw HTML and image loading
  are disabled. Only HTTP, HTTPS, and email links open externally. The preview shows
  the first 200,000 characters of large files; the complete source remains editable.
- Comments participate in undo/redo. Editing their selected text makes them visibly
  unanchored; undo restores the prior anchor. Sideleaf metadata is its own versioned
  format, with no claimed Margin interchange compatibility.
- Development builds are not a signed public release. Tabs, workspaces, advanced
  review, session recovery, and full accessibility/IME acceptance remain later work.

See [PLAN.md](PLAN.md) for product direction and [prototype decisions](docs/prototype.md)
for file safety, runtime boundaries, and platform details. Execution and validation
evidence is recorded in the [first verification](docs/verification-2026-09-07.md)
and the [size, speed and Windows follow-up](docs/performance-2026-09-07.md).
The macOS development package is about 73 MiB. A controlled empty-app measurement
is about 321 MiB across the host and webview processes; memory remains a major
prototype limitation. The packaged Windows app includes an
[idle-CPU fix and measured verification](docs/windows-runtime-2026-09-07.md).
`npm run bench:editor` repeats the isolated editing benchmark.

The website is [sideleaf.xyz](https://sideleaf.xyz), maintained separately in
[kortexa-ai/sideleaf](https://github.com/kortexa-ai/sideleaf).
