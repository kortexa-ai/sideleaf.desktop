# The length of the front matter, and a word count without it

Issue: https://github.com/kortexa-ai/sideleaf.desktop/issues/94

The word count in the status bar now leaves the front matter out. It counts the
words of the text below the block. The count stays incremental: Sideleaf counts the
words of the block only when it reads the block again, and takes them from the count
of the whole document. A title on the count says that the front matter is not
counted. Plain-text documents and documents without a block count as before.

The front-matter line now ends with the number of fields and the length of the block,
for example `4 fields · 612 characters`. The length is the text between the two marker
lines in Unicode code points, line breaks included. Both panes show it, closed and
open. When the line is too narrow for a useful glance, only the length goes.

Open in the preview, a value longer than 200 characters shows its own length under
it. Shorter values show nothing. The open block in the editor stays the literal
source.

Issue #92 (https://github.com/kortexa-ai/sideleaf.desktop/issues/92) is built in the
same change. TOML front matter between `+++` lines and a YAML block that closes with
`...` now work like the `---` block. A `+++` block closes only with `+++`. Line 2
must be a key line of the right kind. The TOML reader is best effort, not a parser.

Execution evidence belongs in the issues and Project 4.
