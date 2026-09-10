# Sideleaf desktop #32 — Windows dark editor scrollbar seam

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/32>

## Scope

- Remove the off-color vertical strip beside the Windows editor in dark split
  view.
- Preserve an understated but visible editor scrollbar in both appearances.
- Validate the fix in the interactive Windows build on Scrappy.

## Cause

- CodeMirror reserves a native scrollbar track on Windows. The WebView's
  default dark track color does not match Sideleaf's document surface, so the
  empty track looks like a full-height pane between the editor and preview.

## Validation

- Run the complete test suite with the native Windows Bun runtime.
- Inspect empty and scrollable documents in Dark and Light appearances at
  normal and compact window sizes.
