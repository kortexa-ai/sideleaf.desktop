# Sideleaf desktop #22 — appearance themes

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/22>

## Scope

- Add System, Light, and Dark appearance preferences, defaulting to System and
  persisting an explicit choice locally.
- Apply the resolved appearance to the editor, preview, title bar, menus,
  settings, notices, dialogs, comments, and empty state.
- Put a labeled three-state selector in Settings and compact Sun, Moon, and
  Computer controls beside document zoom in the status bar.
- Follow live operating-system appearance changes while System is selected.

## Validation

- Unit-test storage validation and System resolution.
- Validate and visually inspect light, dark, and System modes in the packaged
  macOS app at normal and compact sizes. Windows runtime verification is
  deferred until Scrappy is available again.

## Results

- `bun run validate` passes 53 tests, and the development package builds.
- The packaged macOS app switches between all three choices, restores an
  explicit choice after restart, and follows the current dark System setting.
- Dark mode was inspected across the title bar, editor, empty preview,
  hamburger menu, Settings, and About. The empty-state art blends into the
  dark page without a light rectangle.
- Normal, 680×520, and 500×480 window checks keep the footer controls visible;
  the illustration hides at the shortest size as intended.
- Primary light/dark text and muted status text meet WCAG AA contrast; the
  lowest measured normal-text pair is 4.64:1.
