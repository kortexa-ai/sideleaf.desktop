# Sideleaf #20 — document lifecycle and recovery

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/20>

## Decisions

- Command-W closes the current document, not the application. A dirty document
  receives the usual Save, Discard Changes, or Cancel choice before Sideleaf
  opens a fresh untitled document.
- Command-Q, the native window close control, and Alt-F4 quit the application.
  Named dirty documents use the same confirmation. An untitled draft is
  durably retained on quit when untitled-draft restoration is enabled.
- Autosave runs every 30 seconds when enabled. Named documents save to their
  existing path after the normal external-change checks. Untitled documents
  save to one private recovery record in the platform application-data folder;
  this does not mark them as saved Markdown files.
- The recovery record is bounded, validated, fsynced, atomically replaced, and
  private on POSIX systems. Invalid recovery data is left untouched and never
  prevents the editor from starting.
- Opening or creating another document, explicitly discarding an untitled
  draft, saving it as a file, or disabling restoration clears the recovery
  record. A restored draft remains visibly unsaved until it is saved or
  discarded.

## Validation contract

- Unit-test Unicode text and comments through scratch save/load, private file
  mode, corrupt-record rejection and preservation, and idempotent clearing.
- Verify the complete typecheck and test suite on macOS and Windows.
- Exercise Command-W and Command-Q in the packaged macOS app, including cancel,
  discard, save, and restore behavior for an untitled draft.
- Exercise the corresponding Ctrl-W and window-close behavior in the packaged
  Windows app.
