# Sideleaf #21 — macOS hamburger menu follow-up

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/21>

## Decisions

- Do not dismiss on focus loss. WebKit can move focus outside the menu before
  delivering an item's click; outside pointer input, Escape, and Tab provide
  dismissal without racing activation.
- Put initial modal focus on the About dialog instead of its website button.
  Keyboard users still receive the normal visible focus indicator when they
  tab to a control.

## Validation contract

- Exercise every hamburger command on macOS with pointer input.
- Exercise menu traversal and activation from the keyboard.
- Confirm that About opens without an initial website-link focus border.
