# Sideleaf desktop #30 — macOS custom shortcuts

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/30>

## Scope

- Move Sideleaf's Write, Split, Read, Comment, and distraction-free actions
  from Command-Option to Command-Shift on macOS.
- Keep the Windows Control-Alt chords unchanged.
- Leave standard save, close, quit, and zoom shortcuts unchanged. Because
  Command-Shift-S now selects Split on macOS, keep Save As available in the
  File menu there without an accelerator.
- Retain the existing current-line fallback when Comment has no selection.

## Validation

- Cover exact modifier routing, old-chord rejection, native accelerator text,
  the Split/Save As distinction, and the existing comment range behavior.
- Validate and inspect the packaged macOS app. Windows runtime verification is
  deferred until Scrappy is available again.

## Results

- `bun run validate` passes 53 tests, including exact modifier routing for all
  five custom actions and rejection of the old Option chord.
- In the packaged macOS app, Command-Shift-W/S/R selects Write/Split/Read,
  Command-Shift-D enters distraction-free mode, and Command-Shift-C opens a
  comment for the complete current line when there is no selection.
- Command-Shift-S changes the view without opening Save As. Standard Save and
  the File-menu Save As action remain separate.
