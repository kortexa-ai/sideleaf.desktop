# Front matter shows as one line in both panes

Issue: https://github.com/kortexa-ai/sideleaf.desktop/issues/81

A Markdown file can start with a YAML front-matter block between two `---` lines.
Sideleaf showed it as a rule and a heading. Now the editor and the preview show the
block as one quiet line. The line shows the most useful fields and the number of
fields. A click opens the block. The fold keys and the fold marker open and close it.

A block counts as front matter when the first line is `---`, the second line is a
`key:` line, and a closing `---` ends inside the first 64 KiB. Anything else stays
ordinary Markdown. A later `---` stays a horizontal rule.

The fold in the editor is the one state of the block. The preview follows it, and a
click in the preview folds or unfolds the editor. Each open document has its own
state for the session. A document opens with the block closed and the caret at the
start of the body.

A change that touches the closed block opens it. So the line never shows stale
fields. Backspace or Delete beside the closed block opens it instead of removing it.

Out of scope: TOML `+++` blocks, a `...` closing line, a change to the word count,
and a state that Sideleaf remembers after the document closes.

Execution evidence belongs in the issue and Project 4.
