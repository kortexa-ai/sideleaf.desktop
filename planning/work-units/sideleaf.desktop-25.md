# Sideleaf #25 — Markdown file associations

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/25>

## Scope

Advertise Sideleaf as an editor for Markdown documents to macOS Launch Services
and Windows Default Apps. Opening an associated document must use the existing
document lifecycle instead of merely making the app appear in an OS picker.

## Decisions

- Declare `md`, `markdown`, and `mdown` as editable document types through the
  pinned Electrobun file-association configuration on macOS.
- Replace the framework's generated per-extension UTIs before signing with an
  imported `net.daringfireball.markdown` declaration. This matches the type
  macOS resolves for real `.md` files and keeps Sideleaf in Finder's candidates.
- Handle the framework's `file://` activation event. A launch-time document
  becomes the initial document; a later activation asks the renderer to run its
  normal dirty-document confirmation before replacing the current document.
- Subscribe to document activation in the first imported module, before any
  BrowserWindow dependency initializes Electrobun's native bridge. Retain the
  early event until the initial document is constructed. This covers both cold
  launch and already-running activation without changing native process identity.
- Register a per-user Windows application capability and a Sideleaf-specific
  Markdown ProgID from the installer. Keep the default choice user-controlled
  and open the app-specific Default Apps page from Sideleaf.
- Route Windows shell activation through the existing native launcher adapter's
  `--sideleaf-open` path so Unicode and spaced filenames retain their argument
  boundary.
- Suppress the collapsed final block margin that made a short non-empty preview
  show a scrollbar despite fitting in the pane.

## Validation contract

- Assert the supported extensions and Windows registry contract in tests.
- Build the macOS app and inspect its packaged `CFBundleDocumentTypes`.
- Register the development bundle with Launch Services and open an `.md` file
  through Finder-equivalent OS activation, including an already-running app.
- Build the Windows app and installer on Windows; install it, inspect the
  per-user registration, confirm Sideleaf appears in Default Apps/Open With,
  and open a Markdown filename containing spaces and Unicode through the shell.
