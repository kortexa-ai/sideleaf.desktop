# Sideleaf #21 — macOS hamburger menu follow-up

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/21>

## Decisions

- Do not dismiss on focus loss. WebKit can move focus outside the menu before
  delivering an item's click; outside pointer input, Escape, and Tab provide
  dismissal without racing activation.
- Put initial modal focus on the About dialog instead of its website button.
  Keyboard users still receive the normal visible focus indicator when they
  tab to a control.
- Pointer opening leaves focus on the hamburger instead of forcing the first
  item into the keyboard-focused state. Arrow-key opening still focuses the
  first or last menu item.
- The empty reader keeps its existing invitation, then uses a bundled,
  high-resolution text-free botanical illustration generated from the supplied
  visual reference, with live typographic copy beneath it. The complete group
  centers in the available reader, scales by width and height, hides the art at
  compact heights, and suppresses empty-state overflow.
- macOS Command-Option shortcuts select Write, Split, and Read modes and open
  the comment composer. Native application-menu accelerators own these chords
  so AppKit does not consume Command-Option-W as its conventional Close All.
  With no selection, a comment expands to the current non-empty line before
  its anchor is created.
- A compact settings popover sits beside the hamburger on both platforms and
  is also available as a duplicate native macOS Settings command. Its persisted
  switches control wrapping now and reserve the autosave and untitled-restore
  choices for the document-lifecycle work.
- The main toolbar exposes Find, uses compact icons for all file actions, and
  retains a divider between the create/open and find/save groups. Active view
  text uses the product green.

## Validation contract

- Exercise every hamburger command on macOS with pointer input.
- Exercise menu traversal and activation from the keyboard.
- Confirm that About opens without an initial website-link focus border.
- Confirm that pointer-opened menus have no initial item ring, while keyboard
  opening retains a visible focus target.
- Confirm the botanical empty state is legible at the app's default size.
- Confirm the empty state remains centered without a scrollbar at compact
  widths and heights, including the illustration-hidden threshold.
- Verify empty-selection line expansion with a deterministic editor test and
  exercise all four Command-Option shortcuts in the macOS app.
