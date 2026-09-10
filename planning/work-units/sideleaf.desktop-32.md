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

## Results

- The native Windows test suite passes 50 tests with 3 expected platform skips
  and no failures.
- In Dark appearance, the empty editor track now blends into the document
  surface instead of forming a second column beside the split divider.
- A long document shows a narrow, rounded scrollbar thumb with the same quiet
  palette. The track remains unobtrusive and the thumb stays visible in both
  Dark and Light appearances.
- The empty Light and Dark split layouts remain clean, centered, and free of a
  preview scrollbar. The Windows test app was left in Dark appearance with a
  clean untitled document.
