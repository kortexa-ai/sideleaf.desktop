# Sideleaf desktop #41 — Shortcut discovery menu slice

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/41>

## Scope

- Reorganize the Sideleaf hamburger menu into the requested compact groups.
- Show the platform-specific distraction-free shortcut beside its menu item.
- Keep the WSL command installer available only on supported Windows setups.
- Rename the website entry to Help and point it at the stable Sideleaf docs URL.
- Add a themed Keyboard shortcuts dialog from the hamburger menu, initially
  covering view modes, distraction-free mode, and comments.

## Decisions

- Distraction-free remains Command-Shift-D on macOS and Control-Alt-D on
  Windows. Command-Shift-V is reserved for the Comments-sidebar toggle in #40.
- Shortcut labels come from the same custom-shortcut module as the bindings so
  the visible accelerator cannot drift independently.
- The broader in-app shortcut reference and website Help section remain in
  #41; this work is the first discoverability slice.

## Validation

- Run type checking and the complete Bun test suite.
- Verify menu order, separators, labels, keyboard navigation, and actions in a
  real macOS development build.
- Preserve Windows-only WSL visibility and validate platform label behavior in
  deterministic tests.

## Results

- Type checking and all 54 Bun tests pass.
- The macOS development build shows the requested two-divider grouping with
  the distraction-free action first, Help and About last, and the implemented
  Command-Shift-D chord aligned at the right edge.
- Help opens `https://sideleaf.xyz/docs`. About and Make default editor
  still open their themed dialogs, Check for updates reaches its existing
  result state, and distraction-free enters from the menu and exits with Escape.
- The synchronized Windows development build shows Control-Alt-D, includes
  the Windows-only WSL installer, and uses the same requested grouping.
- The macOS popup presents Write, Split, Read, distraction-free, and Add
  comment with the correct Command-Shift chords. Its layout, theme, focus, and
  dismissal were checked in the live development app.
- The Windows popup presents the same actions with the correct Control-Alt
  chords and matches the dark theme.
