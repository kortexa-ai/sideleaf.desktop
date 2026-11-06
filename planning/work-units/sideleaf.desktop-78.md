# Sideleaf 0.1.11

Issue: https://github.com/kortexa-ai/sideleaf.desktop/issues/78

Support relative document links and heading fragments, an optional monochrome
palette with the original colors as the default, and arbitrary UTF-8 text-file
opening through the bundled CLI. Release acceptance follows the native macOS
and Windows procedures in `internal/TESTING.md` and `docs/releasing.md`.

## Quote markers

Keep the existing left borders on Markdown blockquotes, anchored review excerpts
and comment drafts. These communicate quoted text rather than decorate cards.
The Impeccable `side-tab` exception is scoped to `src/ui/app.css`; other detector
rules remain active. Reconsider the exception if decorative side accents are
introduced to that file.

Execution and release evidence belong in the linked issue and Project 4.
