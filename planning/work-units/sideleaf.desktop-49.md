# Markdown formatting commands

Work: [desktop #49](https://github.com/kortexa-ai/sideleaf.desktop/issues/49).

Use CodeMirror's existing Markdown parser and list commands. Enter exits an empty
list item immediately, including the second item in a tight list. Plain text
retains ordinary Enter and no Markdown formatting.

Bold/italic toggles inspect parsed emphasis, protect code and link destinations,
and preserve block markers. At a cursor inside emphasis, remove that emphasis;
else insert an empty pair with the cursor between it. Each command is one undo
step. Whitespace around selected text is kept outside the markers. Mixed
selections apply uniform emphasis to eligible text, removing redundant same-kind
inner markers; a subsequent toggle removes that emphasis. Two toggles restore
plain source. Existing underscore emphasis can be removed; new emphasis uses
asterisks. Mixed selection normalization does not promise exact source identity
after two toggles. A selection inside one emphasized span toggles the whole span;
marker-only selections are left unchanged.

Cover nested emphasis, code, links, Unicode, reversed/multiple selections, empty
pairs, undo/redo, Markdown/plain-text switching and all supported list markers.
