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

## Validation

Run the focused unit test, full typecheck and test suite, then exercise native
drag, double-click, minimize/maximize/restore, close, snap, and resize behavior
in the macOS and Windows development apps.
