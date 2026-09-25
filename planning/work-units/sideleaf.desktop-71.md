# Open other text files as plain text

Work: [desktop #71](https://github.com/kortexa-ai/sideleaf.desktop/issues/71).

Only `.md`, `.markdown` and `.mdown` are Markdown. Every other name opens as
plain text, including `.txt`, `.json`, `.ini`, `.env` and files without an
extension. The CLI open path already accepted any regular file, so the change
is the type rule. OS activation, the Open dialog and the folder tree still
accept only the registered `md`/`markdown`/`mdown`/`txt` types.

Saves are byte-exact: BOM, LF or CRLF and the final newline are kept. Invalid
UTF-8 and NUL characters are refused. Mixed line endings are still refused on
open. An explicit conversion command is [desktop #72](https://github.com/kortexa-ai/sideleaf.desktop/issues/72).

Comments embed metadata in the file, so they are limited to `.md`/`.markdown`/
`.mdown`/`.txt`. The comment command, the CLI agent commands, live
collaboration targets and annotated saves reject other types.
