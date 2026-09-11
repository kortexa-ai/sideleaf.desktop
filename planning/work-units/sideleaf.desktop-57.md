# Plain-text document support

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/57>
Product direction: [PLAN.md](../../PLAN.md#plain-text-documents)

Use the committed filename to choose plain text for `.txt` (case-insensitive)
and Markdown otherwise. Untitled New is Markdown. A recovered `.txt` draft uses
an untitled text filename and retains its original path for recovery context.
Save As and Rename switch type only after the host confirms success.

Keep one CodeMirror editor and reconfigure its language and accessible label
without replacing the document state. Preserve text, selection, comments and
undo history, including edits made while a save is in flight. Apply the same
configuration when activating an inactive folder buffer. Keep the last Markdown
view choice separately from the effective Write-only view for text.

Hide both view switches and the Markdown-only Single line breaks setting for
text documents. Route all mode changes through the same Write-only guard,
including native shortcuts, comment navigation and distraction-free mode.
Comments remain enabled with the existing embedded metadata and history format;
there is no sidecar, comment stripping, or conversion warning.

Add a native Windows Save As text filter with the current extension selected,
and preserve an explicitly typed extension. Use the existing Mac Save panel.
Register `.txt` as an editor candidate through the Mac bundle and Windows
installer, without changing the user's selected default application.

## Acceptance

Run native macOS and Windows validation and builds at the same source SHA.
Exercise `.txt`/`.TXT`, New, Markdown-to-text and text-to-Markdown Save As and
Rename, cancellation/failure, undo, comments, autosave, external conflicts and
recovery. Switch between dirty Markdown and text buffers in both layouts; check
keyboard guards, comment navigation and distraction-free transitions. Test the
actual installers and OS Open With for Unicode/spaced text filenames, and the
packaged CLI/runtime. Publish the verified source and installers together, then
update the separate website and its documentation.

Mac native spelling parity is a separate, optional fix tracked by
[#58](https://github.com/kortexa-ai/sideleaf.desktop/issues/58). Do not introduce
a new spellchecker or block text support on an unverified framework workaround.
