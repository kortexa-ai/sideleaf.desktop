# Sideleaf desktop #44 — Minimal layout polish

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/44>

## Scope

- Align the Windows Minimal layout and Comments shortcuts with the existing
  Control-Alt custom shortcut family.
- Remove the remaining document strip and editor/preview labels in Minimal
  layout.
- Put New, Open, Save, Save As, Find, and the three view modes in the compact
  title-bar File menu.
- Keep the released 0.1.4 website docs unchanged until the next release.

## Validation

- Run type checking and the complete test suite on macOS and Windows.
- Check the compact File menu, view selection, keyboard navigation, shortcuts,
  layout round trips, title-bar dragging, and top-edge resizing in live builds.

## Results

- macOS type checking and all 56 tests pass. The development package builds,
  Minimal layout hides the document strip and editor/preview labels, and the
  compact File menu exposes the requested actions and view selector.
- The Mac live build passed Find, Read mode, the Command-Shift-M layout round
  trip, and the platform-specific Comments separator placement.
- Windows type checking passes with 53 tests passing and three expected
  platform skips. The running development build was rebuilt from this commit.
- The Windows live build passed the compact menu layout, Find, Read/Split mode
  changes, arrow-key view selection, Escape dismissal, the Settings layout
  round trip, and title-bar dragging. Its shortcut dialog shows Control-Alt-M
  and Control-Alt-V; deterministic shortcut tests cover both bindings and reject
  their old Control-Shift forms.
- The custom Windows frame and top-edge adapter are unchanged, and the existing
  window-control tests remain green.
