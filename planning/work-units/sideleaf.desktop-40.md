# Sideleaf desktop #40 — Minimal layout

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/40>

## Scope

- Add a persisted Minimal layout setting and direct layout-toggle shortcut.
- Move the existing document actions, filename, and Comments control into the
  custom title bar while Minimal layout is enabled.
- Add the Comments-sidebar shortcut and preserve editor selection and focus.
- Extend the keyboard shortcut popup with the new layout shortcuts.

## Decisions

- Minimal layout hides the large toolbar and reduces the document bar to the
  centered Write, Split, and Read switch.
- Existing controls move between their normal and minimal containers. Sideleaf
  does not duplicate action handlers, dirty state, comment counts, or file
  identity UI.
- Command-Shift-M and Control-Shift-M toggle Minimal layout. Command-Shift-V
  and Control-Shift-V toggle Comments. The latter does not intercept input in
  comment text fields.
- The document filename is pointer-transparent inside the draggable title bar.
  Every interactive title-bar control remains an explicit no-drag region.

## Validation

- Run type checking and the complete test suite on macOS and Windows.
- Check persistence, both shortcuts, menu keyboard behavior, focus restoration,
  responsive truncation, title-bar dragging, top-edge resizing, and the normal
  layout round trip in real development builds on both platforms.

## Results

- `bun run validate` passes on macOS: 56 tests, 0 failures.
- `bun run build` produces the macOS ARM64 development app.
- The macOS development app preserves Minimal layout across restart, returns to
  the full layout with Command-Shift-M, exposes all four document actions from
  the title bar, and opens and closes Comments with Command-Shift-V.
- The focused real-app shortcut check caught and fixed an inverted Comments
  toggle before the Windows validation pass.
