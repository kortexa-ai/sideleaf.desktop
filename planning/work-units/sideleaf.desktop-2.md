# Packaged Markdown prototype

Work item: https://github.com/kortexa-ai/sideleaf.desktop/issues/2

The user requested implementation of PLAN.md, a fal.ai app icon, and support for both
macOS and Windows. The desktop source is independent of Margin. Zendo was consulted
for the runtime/build pattern only.

The first slice adds the Cottontail host, a system-webview CodeMirror editor, Markdown
preview, native file picking, conflict detection, atomic saves, and versioned anchored
comments. The icon source and prompt are committed; generated app packages and local
test documents are ignored.

Validation evidence and cross-machine delivery are recorded in the owning GitHub
issue. The desktop program plan remains the durable direction; this note does not
declare the later daily-use, distribution, or complete IME/accessibility gates passed.
