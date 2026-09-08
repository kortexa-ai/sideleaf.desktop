# Third-party software

Sideleaf's own source is MIT-licensed. The complete notices in
[`licenses/third-party.txt`](licenses/third-party.txt) are also included inside
each installed application. Those licenses continue to govern their components.

| Component | License |
| --- | --- |
| Electrobun, Cottontail, zig-asar, zig-bsdiff, zig-zstd | MIT |
| CodeMirror, Lezer, markdown-it and most browser dependencies | MIT |
| entities | BSD 2-Clause |
| argparse | Python Software Foundation |
| JavaScriptCore, WTF, bmalloc and other WebKit source | LGPL and BSD; see source headers |
| ICU | Unicode/ICU license and included third-party notices |
| OpenSSL | Apache 2.0 |
| libuv, libffi, Zig standard library | MIT and their retained notices |
| zlib | zlib license |
| zstd | BSD 3-Clause |
| Microsoft WebView2 SDK loader | Microsoft WebView2 SDK redistribution terms |

The operating system supplies WKWebView or WebView2. Sideleaf does not bundle
Chromium, Node, Bun, a model, or a cloud service. The runtime contains some
third-party source originally incorporated by Bun; its original notice is
retained and includes optional components not shipped by Sideleaf.

## Runtime source and relinking

The application uses Cottontail with statically linked JavaScriptCore. The
corresponding runtime source materials are available with the binary downloads
on the [Sideleaf releases page](https://github.com/kortexa-ai/sideleaf.desktop/releases).
They include the upstream source and patches needed to rebuild the library and
the runtime that links it. You may modify and relink these components for your
own use; the Sideleaf terms do not restrict the rights their licenses grant.

The pinned inputs for v0.1.0 are:

- [Cottontail](https://github.com/blackboardsh/cottontail/tree/e5ddf52648c502b1b124ec5f41a9b87b7b9ecedb),
  including its build scripts and runtime module source.
- [JavaScriptCore build scripts and patches](https://github.com/blackboardsh/jsc/tree/46a8b00303faeba2c09854e78511845e9ccbeb9a),
  based on [WebKit 27877cc2](https://github.com/WebKit/WebKit/tree/27877cc2acd8a3cea8b3827ddb48d6c6c0177714).
- [ICU 70.1](https://github.com/unicode-org/icu/releases/tag/release-70-1).
- [Electrobun 2.0.2-beta.15](https://github.com/blackboardsh/electrobun/tree/69e9faf89217100b65513fc6c339ec6a0010515b).

Use the included JavaScriptCore workflow for your platform to build a changed
static SDK, then set `COTTONTAIL_JSC_ARCHIVE` to that SDK when running Cottontail's
`scripts/setup-jsc.js` and build the runtime with `scripts/zig.js build`.
Its source includes the native bindings and module sources needed for relinking.
Use that runtime in a local development build of Sideleaf. A modified macOS
binary needs its own local signature; it does not carry the distributed app's
Developer ID signature.

`node scripts/generate-notices.mjs` regenerates the notice from installed npm
dependencies and the checksum-pinned license inputs in
`scripts/third-party-sources.json`. Review runtime notices and source materials
when changing native dependencies.
