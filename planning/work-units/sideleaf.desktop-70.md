# Inline `<br>` in the Markdown preview

Work: [desktop #70](https://github.com/kortexa-ai/sideleaf.desktop/issues/70).

The preview keeps markdown-it's `html: false`, so raw HTML stays escaped. One
inline rule turns only a bare `<br>`, `<br/>` or `<br />` (any case) into a
hard break. This is the usual line break in a GFM table cell. Attributes, other
tags and code spans stay literal. The source text is unchanged. Wider HTML
support needs a new issue.
