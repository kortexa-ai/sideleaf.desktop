# Sideleaf #83 — Ziblet button and Get Ziblet on macOS

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/83>

## Scope

Ziblet (<https://ziblet.app>) is a macOS app that keeps tasks and notes as
Markdown files in one folder. On macOS, Sideleaf shows a Ziblet button when
Ziblet and its notes folder are present, and opens that folder as a workspace.
The hamburger menu offers Get Ziblet on macOS. Windows and Linux do not change.

## Decisions

- **Launch Services through `osascript`.** JavaScript for Automation calls
  `NSWorkspace.URLForApplicationWithBundleIdentifier` for
  `ai.kortexa.ziblet.osx`. This finds Ziblet wherever it is installed, sends no
  Apple event and does not start Ziblet. It needs no native addition to the app.
- **The `dataFolder` preference with a default.** Sideleaf reads only that one key
  with `defaults read`. Current Ziblet versions do not write it, so an absent,
  empty or relative value means `~/kortexa/ziblet`. The folder must exist as a
  directory; discovery does not read or list it.
- **Bounded and quiet.** Commands run asynchronously with a short timeout. A failed
  or slow command hides the button instead of raising an error.
- **The renderer never passes a path.** It asks once at startup whether Ziblet was
  found. Open Ziblet makes the main process discover the folder again and hand it to
  the external-open path with kind `open-folder`, so unsaved work gets the same
  question as a folder from Finder. If Ziblet or the folder is gone, the request
  fails with a short message.
- **macOS only.** Discovery returns nothing on other platforms and runs no command.
  The renderer queries only on macOS, and the menu separator and Get Ziblet stay
  hidden elsewhere. The native application menu does not change.
- The toolbar button sits left of New with the label Notes. In Minimal layout the
  same button moves into the title bar, left of the folder button, without a label.
  The icon is Ziblet's ten-dot Z drawn in one colour.

## Validation contract

- Unit tests cover non-macOS, a missing app, a present preference, an absent,
  empty or relative preference, a missing folder, and a failed or timed-out
  command, with injected command execution.
- Run `bun run validate` and a development build.
- The lead checks the visible apps: on macOS, the button in both layouts, opening
  the folder with and without unsaved work, and Get Ziblet; on Windows, an
  unchanged toolbar and menu.
