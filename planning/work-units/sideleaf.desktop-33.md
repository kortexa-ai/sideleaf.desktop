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
