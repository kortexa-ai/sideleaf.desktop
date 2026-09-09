# Sideleaf 19 — Native custom title bar

## Scope

Use the proven Relay desktop window-chrome pattern for Sideleaf on macOS and
Windows. Keep native macOS traffic lights and Windows resize/snap behavior,
provide accessible custom Windows controls, and make non-interactive header
space draggable. Sideleaf has no station identity, so its caption strip stays
visually quiet.

## Decisions

- Use Electrobun `hiddenInset` only on macOS and Windows.
- Keep document and application actions outside drag handling.
- Route Windows caption movement and the system menu through the native HWND;
  the webview can request only a closed set of window actions.
- Honor the macOS title-bar double-click preference.
- Group the Windows Sideleaf menu with subtle separators. Keep default-app
  selection user-controlled through Windows Settings and show About natively.
- Put the shared hamburger menu in the native caption strip: left on Windows
  and right on macOS. Keep the macOS application-menu duplicates, theme About
  like the editor, and align the leaf/app name with the document mark/name.

## Validation

Run the focused unit test, full typecheck and test suite, then exercise native
drag, double-click, minimize/maximize/restore, close, snap, and resize behavior
in the macOS and Windows development apps.
