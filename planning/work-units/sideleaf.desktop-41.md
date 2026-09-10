# Sideleaf desktop #41 — Shortcut discovery menu slice

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/41>

## Scope

- Reorganize the Sideleaf hamburger menu into the requested compact groups.
- Show the platform-specific distraction-free shortcut beside its menu item.
- Keep the WSL command installer available only on supported Windows setups.
- Rename the website entry to Help while it continues to open the Sideleaf
  home page until the website documentation exists.

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
- Help opens the current Sideleaf home page. About and Make default editor
  still open their themed dialogs, Check for updates reaches its existing
  result state, and distraction-free enters from the menu and exits with Escape.
- The Windows label is covered by the shared shortcut test; packaged Windows
  menu validation remains required after Git synchronization to Scrappy.
