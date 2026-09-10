# Sideleaf desktop #33 — Windows title-bar drag and top resize

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/33>

## Scope

- Restore mouse dragging from the custom Windows caption strip.
- Restore the native vertical resize target at the top window border.
- Preserve the hamburger, settings, and minimize/maximize/close controls as
  interactive non-drag regions.

## Cause

- Sideleaf adopted the native caption bridge from Relay but missed Relay's
  later correction that marks the dedicated Windows caption strip as a drag
  region. The containing top bar is intentionally non-drag on Windows, so the
  omission left the WebView owning all otherwise-empty caption pixels.

## Validation

- Run the complete test suite on macOS and Windows.
- On Scrappy, verify a real pointer drag changes the native window rectangle.
- Verify vertical resizing from the top edge and resizing from the other three
  edges, plus double-click maximize and the caption controls.

## Results

- A clean Windows rebuild contains the corrected caption-region rule. The
  running window follows a pointer drag by the same horizontal and vertical
  delta, and dragging from maximized state restores and continues moving it.
- Dragging the top edge moves only the top boundary. Separate pointer checks
  also resize from the left, right, and bottom boundaries.
- Double-click maximize and the custom maximize/restore controls still work.
  The hamburger and Settings controls remain interactive non-drag regions.
- Native Windows validation passes 50 tests with 3 expected platform skips and
  no failures. Local macOS validation passes all 53 tests.
- Scrappy is left with the current development build open on a clean untitled
  document in Dark appearance.
