# Sideleaf #26 — distraction-free mode

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/26>

## Scope

Add a native full-screen writing mode that removes Sideleaf's application
chrome while keeping the editor, preview, comments, and Write / Split / Read
mode shortcuts usable.

## Decisions

- Enter or exit through one renderer command so the hamburger action, macOS
  View menu, and `Cmd/Ctrl-Option-D` shortcut share the same behavior.
- Use the native Electrobun full-screen API rather than simulating a maximized
  window. Hide only Sideleaf's chrome; keep conflict and error messages visible
  because they protect document correctness.
- Hide editor and preview pane labels in the focused layout. Retain the comments
  pane label so a comment opened by shortcut can still be dismissed.
- Preserve the selected Write / Split / Read mode and editor selection across
  the transition. `Escape` exits from any focused content surface.

## Validation contract

- Unit-test the native full-screen window actions and invalid-action boundary.
- Exercise the packaged macOS and Windows apps, including entry, Escape exit,
  and Write / Split / Read shortcuts while the title bar is absent.
