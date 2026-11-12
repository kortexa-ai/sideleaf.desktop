# Sideleaf #79 — macOS Dock folder drops

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/79>

## Scope

Accept an ordinary folder dropped onto the macOS Dock icon and open it as a
workspace through the existing Open Folder lifecycle.

## Decisions

- Declare `public.folder` in the macOS bundle as an alternate viewer so Finder
  remains the normal folder opener. Keep Markdown and text associations intact.
- Classify native file URLs by filesystem type before checking document suffixes.
  A directory named with a document extension still opens as a folder.
- Retain the file/folder request kind through the early activation queue and
  running-app receiver. Folder replacement uses the existing checks for unsaved
  documents and pending comments across the whole workspace.
- Keep the existing local-URL validation and registered-document restrictions.
  Do not add general file associations or Windows folder shell registration.

## Windows taskbar boundary

Microsoft's documented Windows 11 taskbar drag flow raises the running app's
window on hover; the user then drops into that window. This does not supply the
Dock-style native open activation used by this change. App-window folder drops
would require a separate input path.

Reference: [Windows 11 taskbar drag behavior](https://blogs.windows.com/windows-insider/2022/02/16/announcing-windows-11-insider-preview-build-22557/).

## Validation contract

- Cover directory classification, Unicode/spaced paths, file and folder event
  buffering, and rejection of unsupported or invalid activation URLs.
- Run `bun run validate` and inspect the macOS bundle document declarations after
  a development build when available without desktop interaction.
- Native macOS/Windows desktop acceptance and release checks are deferred by
  explicit user instruction. Do not bump the version or publish a release.
