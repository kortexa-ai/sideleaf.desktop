# Sideleaf desktop #31 — Windows appearance and shortcut acceptance

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/31>

## Scope

- Validate the Windows build delivered for issues #22 and #30 on Scrappy.
- Exercise the Windows Control-Alt shortcuts, appearance controls and
  persistence, themed menus and dialogs, and compact empty-document layouts.
- Record and fix any Windows-specific defect before closing the feature issues.

## Validation

- Fast-forward the clean Scrappy checkout to the exact delivered commit and
  run the test suite with the native Windows Bun runtime.
- Run the development package in the interactive Windows session and send
  actual Windows virtual keys through the on-screen keyboard.
- Inspect Light, Dark, and System appearances at normal and compact sizes,
  including a full app restart with an explicit appearance selected.

## Results

- Scrappy ran commit `f5be1fa288b15f3de3e54533388062285e9d5075` from a clean
  `main` checkout. Native Windows validation passes 50 tests with 3 expected
  platform skips and no failures.
- Control-Alt-W/S/R selects Write/Split/Read. Control-Alt-D enters
  distraction-free mode and Escape exits it. Control-Alt-C with no selection
  selects the complete current line and opens the comment form.
- Settings and status-bar controls select Light, Dark, and System. An explicit
  Light preference survives a full app restart; System resolves to Scrappy's
  current dark application appearance.
- The dark hamburger menu and About dialog render correctly without the old
  focus border. The title-bar double-click maximizes the window.
- The empty preview stays centered without a preview scrollbar at normal and
  compact sizes. File actions collapse to icons at narrow width, and the
  illustration hides at short height while the text remains visible.
- No Windows-specific defect was found. The test app was left on System
  appearance with a clean untitled document.
