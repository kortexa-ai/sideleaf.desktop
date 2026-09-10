# Sideleaf #27 — document zoom

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/27>

## Scope

Scale the editor and rendered Markdown together without enlarging the
application chrome.

## Decisions

- Use a 70–180 percent range in predictable ten-percent steps, with 100
  percent as the reset point.
- Persist one document-zoom preference locally and apply it across Write,
  Split, and Read modes.
- Put a compact slider and percentage reset control immediately after the
  writing status in the footer. Keep the percentage visible and collapse
  lower-priority status details before the footer can overflow.
- Provide native macOS View-menu accelerators and renderer-owned Windows
  shortcuts for zoom in, zoom out, and reset.

## Validation contract

- Unit-test normalization, persistence input, stepping, and range boundaries.
- Exercise shortcuts, slider input, reset, and all three document layouts on
  macOS and Windows.
- Verify the controls at the default and a narrow window size.
