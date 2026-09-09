# Sideleaf desktop plan

## Direction

Build a small, fast, portable Markdown editor that owns its future. The name is
**Sideleaf**, the domain is **sideleaf.xyz**, and the intended command is `sideleaf`.
The domain has been purchased. Keep the public desktop project and private website in separate
repositories under `kortexa-ai`:

| Repository | Responsibility |
| --- | --- |
| `sideleaf.desktop` | Desktop app, document behavior, packaging, and agent CLI |
| `sideleaf` | Website and distribution entry point; a parking page initially |

This is a new implementation. Margin is a product specification and a source of
observable workflow ideas. Do not port, copy, translate, or use its implementation as
the architectural blueprint. “From first principles” means designing Sideleaf's own
product and document boundaries; it does not mean writing every text or rendering
primitive ourselves. Third-party JavaScript libraries are explicitly welcome.

The priorities are reliable editing, ordinary portable files, a small application
bundle, responsive interaction, and low operational complexity. Measure these goals
instead of assuming the framework guarantees them.

## Why take a stab at a new app

Depending on upstream acceptance is an uncertain maintenance strategy. A hard fork of
Margin would give us control, but it would also retain the existing product and platform
architecture. A bounded fresh prototype tests whether the desired smaller architecture
can deliver the daily workflow at a manageable maintenance cost.

Keep the installed Margin available while Sideleaf proves itself. Fix an urgent Margin
problem if it blocks current work, but avoid growing two full products in parallel.
Do not make unmerged upstream contributions a prerequisite for Sideleaf. This does not
assume that open-source projects generally reject contributions.

The first decision gate is a working editor with one trustworthy comment workflow.
Continue if it feels good and preserves documents reliably. If basic editing or native
integration proves unsuitable after a bounded investigation, reconsider the architecture
or a Margin hard fork deliberately. Do not pursue feature parity merely because a
prototype exists.

## Architecture decisions

| Area | Starting decision | Reason / qualification |
| --- | --- | --- |
| Desktop host | Electrobun with Cottontail | Reuse the stack already explored in Zendo; keep native integration small |
| Main UI | A system webview with DOM and CSS | Portable text layout, mature editing primitives, smaller distribution than bundling a browser |
| Editor | CodeMirror 6 is the leading candidate | Source editing, transactions, history, selections, syntax support, and composition handling |
| Markdown viewer | A mature JS parser and HTML renderer | Prefer a small dependency such as markdown-it or a suitable unified/remark pipeline after a short spike |
| Native drawing | No Warren requirement | Its rendering layer is not needed for the first editor/viewer |
| Browser distribution | No bundled Chromium/CEF initially | Test system engines first; revisit only for a demonstrated platform blocker |
| Persistence | Ordinary local Markdown files | No account, hosted database, or daemon required to open and edit documents |
| Source | Independent implementation | Margin supplies product expectations, not implementation code |

Pin an exact tested Electrobun/Cottontail toolchain during the first implementation
slice. Do not write a second application runtime or import all of Zendo's functionality.
Use `../zendo.sh` for build setup, window lifecycle, native integration, and typed bridge
patterns. Its system-webview composer is a useful example; its custom GPU terminal and
agent workspace are separate product concerns.

The reference checkout used Electrobun `2.0.2-beta.13` during the initial discussion.
That is historical context, not a required version. Recheck the current supported
toolchain, Cottontail packaging, licensing, and API contracts before pinning dependencies.

### Boundaries

1. **Native host:** windows, application menus, native file dialogs, file associations,
   OS open-file events, filesystem access, file watching, and packaging.
2. **Document services:** stable document identity, content revisions, saves, conflicts,
   annotations, comparison snapshots, and agent CLI operations.
3. **Editor/viewer UI:** CodeMirror, Markdown preview, tabs, file navigation, selection
   presentation, and comment interactions.
4. **Typed bridge:** explicit requests and events between host and webview. Validate
   payloads and keep file access limited to the documents/workspaces the user opened.

Use one main webview per window unless real measurements justify something else. Keep
document logic testable without a browser and platform adapters small enough to replace.
Choose a UI framework only if the first slice benefits from it; avoid building a framework
within the app. Use Bun for dependency installation, repository scripts, and tests; Hutch owns the
Electrobun desktop toolchain. Developers do not need a separate Node or npm installation.

Markdown content is untrusted input, even in a local editor. Disable raw HTML initially
or sanitize it through a reviewed renderer policy. Restrict link schemes, handle external
links through a deliberate native action, and prevent rendered content from acquiring
the host bridge. Define local-image resolution and remote-image loading behavior before
enabling them. Never turn the bridge into arbitrary command or filesystem execution.

### Portable annotations and application identity

The canonical application identifier is `ai.kortexa.sideleaf` across bundle metadata
and Windows taskbar integration. Website and repository names are independent.

Store comments and up to three retained source-hash-linked comment revisions in a
versioned terminal JSON HTML comment inside the Markdown file. The editor and reader
show only literal source; metadata is managed by shared document services. Existing
sidecars migrate on a verified atomic save and remain as uniquely named backups.
Plain files without annotation history remain plain. Full text snapshots, document
comparison, multi-file transactions and semantic merge remain deferred.

## What system webviews cost us

System webviews are a reasonable starting choice. They move the browser engine out of
the app bundle; they do not remove its memory, process, layout, or startup costs. A webview
app is not automatically faster or lighter in RAM than Margin's native Swift app.

The operating systems supply different engines and runtime versions. At planning time,
the documented system renderer paths are WKWebView on macOS, WebView2 on Windows, and
WebKitGTK on Linux. Confirm the actual Electrobun release's supported OS/architecture
matrix when implementing: do not promise Intel macOS, native Windows ARM, or a particular
Linux distribution merely because the UI is JavaScript.

| Risk | How to establish whether it matters |
| --- | --- |
| Different selection, caret, clipboard, and layout behavior | Run the same document and editing scenarios in each packaged platform app |
| IME and composition errors | Exercise composition, dead keys, accents, emoji, and undo during real native input |
| Accessibility gaps | Check keyboard navigation and the relevant OS screen reader, not just DOM semantics |
| Platform-owned runtime updates | Reproduce against supported OS/runtime versions; maintain a small compatibility matrix |
| WebView2 availability | Verify the installer/bootstrap path on a clean supported Windows system |
| Linux shared library dependencies | Document and test required GTK/WebKitGTK packages in a clean target environment |
| Large-document memory or typing latency | Profile realistic fixtures and total process-tree cost in the packaged application |

WebView2's normal Evergreen runtime can update independently of Sideleaf. WKWebView
behavior follows the supported macOS versions. Linux runtime packaging varies by distro.
A serious engine bug could require a targeted workaround, a higher minimum OS version,
or a different renderer on one platform. Keep those escape routes possible without
paying for them in the first build.

A custom GPU editor would add text shaping, line wrapping, hit testing, composition,
clipboard, accessibility, and caret behavior to our responsibilities. Warren/Dawn may
also affect bundle size. There is no demonstrated need for that work in this product.

## Product specification from Margin

These are workflow references, not an instruction to ship every feature. Start smaller
and add features because daily use needs them.

### Editing and reading

- Open ordinary `.md` files, edit literal Markdown, and save without unwanted rewriting.
- Provide syntax cues, normal selection and navigation, familiar formatting shortcuts,
  sensible delimiter pairing and list continuation, undo/redo, and find/replace.
- Support spellcheck, keyboard access, and accessible editing within platform limits.
- Render useful Markdown: headings, paragraphs, emphasis, links, lists, tasks, code,
  block quotes, tables, and images. Define the supported dialect and extensions explicitly.
- Offer source and reader views, with predictable focus, scroll, and selection mapping.
- Add tabs, multiple windows, a file tree, recent workspaces, and session restoration
  after the single-document path is reliable. Index folders lazily; do not preload every file.

### Comments and review

- Anchor a comment to an explicit selection; show the relevant text and comment clearly.
- Support thread replies, resolve/reopen, editing permitted comments, and later unread
  activity and external updates.
- Preserve anchors through nearby edits. For deleted or ambiguous target text, keep the
  comment and make its orphaned state explicit instead of attaching it to unrelated text.
- Treat gutter markers, highlights, focus, and keyboard access as part of the interaction.
- If format compatibility with Margin is wanted, implement it from a documented format
  specification and fixtures, with round-trip checks. Do not silently claim compatibility.

### Comparison, later

- Compare two explicit document snapshots without requiring a Git repository.
- Show bounded, understandable diffs and selection-based discussion.
- Consider `.marginreview` interchange only after a compatibility decision.
- Applying a comparison must participate in coherent document revision and undo behavior.

### Agent CLI and later collaboration

- Ship an installable `sideleaf` CLI on macOS, Windows and WSL for opening files,
  reading/editing Markdown and listing/adding/updating/removing comments without a GUI.
- Use the app's bundled Cottontail runtime for the CLI. End users never need Node,
  Bun or npm. macOS and Windows expose an installation command in the Sideleaf menu;
  the Windows installer also offers native CLI installation. A separate Windows menu
  command installs a WSL wrapper into the detected default distro, only when available.
  The Windows installer never modifies WSL. WSL wrappers reuse the Windows runtime;
  saves to WSL-native files preserve Linux permissions using distro filesystem tools.
- Share embedded metadata and document services, deterministic JSON reads, explicit
  actor attribution, UTF-16 coordinates, and mandatory revision preconditions.
- Keep watch events, suggestions and richer review operations separately scoped.
- Revisions, idempotency, concurrent writes, multi-file transactions, recovery, reconciliation,
  and semantic merge require their own design and adversarial fixtures. They are not MVP
  dependencies.

No built-in accounts, cloud sync service, telemetry pipeline, model runtime, collaboration
daemon, or embedded database is required for the first product. Release checks may contact
GitHub at most daily and display a quiet, dismissible update link. Installing an update is
explicit. Describe runtime compatibility downloads and website logs in the privacy policy. Local files can live in a
user's existing synced folder; that makes external conflict handling more important.

## Document correctness is the hard part

Mature libraries shorten editor and viewer implementation. They do not decide Sideleaf's
save semantics, comment format, conflict handling, or revision model.

- **Preservation:** retain the user's Markdown, line endings, and supported encoding.
  Define unsupported encoding handling explicitly. Avoid parse-and-reserialize on save.
- **History:** keep coherent undo/redo for text operations. Decide how comment changes
  participate in history and how external reloads form history boundaries.
- **Coordinates:** distinguish editor UTF-16 positions, Unicode text, byte offsets, and
  rendered DOM positions. Never assume these coordinate systems are interchangeable.
- **Identity:** give each open document a stable identity, path state, and content revision;
  define Save As, rename, replacement, and duplicate-window behavior.
- **Saving:** use atomic replacement where supported, surface errors, and handle permissions,
  symlinks, and interrupted writes. “Saved” must mean the intended data reached disk.
- **External writes:** identify self-writes; reload clean documents safely; preserve unsaved
  edits when disk changes conflict. Do not silently pick whichever writer finished last.
- **Annotations:** use the embedded format and retain legacy migration backups.
  Preserve portability, anchor context, and recovery when a save cannot complete. An orphaned comment is preferable to a wrong anchor.
- **Recovery:** retain recoverable unsaved state without modifying the original file behind
  the user's back. Test crash and failed-save paths before relying on autosave.

## Implementation sequence and acceptance gates

### 0. Establish the smallest real desktop shell

- Pin the runtime and build tools; open a system-webview window through Electrobun.
- Package and launch a macOS development app immediately. Verify real menu shortcuts,
  focus, clipboard, native open/save dialogs, and the filesystem bridge.
- Measure cold launch and the baseline app/process memory and package size.

**Exit:** a reproducible packaged app and an understood native/UI boundary, without
placeholder architecture that depends on a normal browser-only development server.

### 1. Prove an end-to-end document and comment workflow

- Open a real Markdown file, edit in CodeMirror, save, and preview it.
- Handle an external file change while both clean and dirty.
- Select text, add one anchored comment, edit near it, save, close, and reopen.
- Preserve source, comments, selection intent, and expected undo behavior.
- Exercise a short document, a large document, Unicode/emoji, and composition input.

**Exit:** daily interaction feels responsive and the fixture workflows survive save/reopen
and external edits without data loss or silent anchor corruption. Compare measurements
against Margin on the same machine and files. Record engine/runtime versions.

This is the go/no-go gate for expanding the new implementation. Set measured performance
budgets after collecting the baseline; do not publish invented RAM, size, or launch claims.

### 2. Make it useful every day on macOS

- Add tabs, file navigation, find/replace, recent files/workspaces, and session restoration.
- Complete basic comment threads and their keyboard interactions.
- Add reliable autosave/recovery and clear conflict handling after explicit save works.
- Make source/reader switching, links, local images, and large-file behavior predictable.
- Validate native file associations, open-file events, multiple windows, and accessibility.

**Exit:** use Sideleaf for normal personal editing without depending on Margin for basic
document operations. Fix correctness and usability defects before widening the feature set.

### 3. Establish supported platforms and polished distribution

- Build and exercise real Windows and Linux packages on supported systems.
- Validate webview/runtime installation, keyboard conventions, path behavior, file watching,
  clipboard, screen readers, DPI/scaling, and fonts across those systems.
- Finish the reader, comments, workspace behavior, and selected comparison workflows.
- Add reproducible signing, notarization, packaging, and an intentional update strategy.
- Use the existing Kortexa signing setup through the supported Electrobun/Hutch path;
  keep all credentials local and ignored. Test Gatekeeper on the actual distributable.

**Exit:** publish only the platforms and features that pass real packaged-app checks.
Cross-platform compilation alone is not portability acceptance.

### 4. Add advanced capabilities when justified

Design the richer CLI, interchange, suggestions, actor/revision semantics, transactions,
and comparison application as separate work units. Keep the app usable offline and the
format understandable without Sideleaf. Revisit bundled CEF or native drawing only when
a reproducible limitation justifies the cost.

## Decisions to make during the prototype

- Exact supported OS versions and architectures, and tested runtime/toolchain pins.
- Markdown dialect and parser, raw HTML policy, image loading, and renderer extensions.
- Markdown/comment/review interchange with Margin, if needed.
- Save/autosave policy, crash recovery, external conflict UI, and comment history semantics.
- A UI framework, if one adds enough value to justify the dependency.
- Measured launch, memory, document size, typing, and scrolling budgets.
- Distribution channels, release/update signing, public source licensing, and future pricing.

Do not block the smallest prototype on decisions that can be isolated and changed later.
Resolve storage and document preservation semantics before relying on the app for important
files. Record each decision and its evidence in the owning work issue; keep this plan as the
durable product and architecture reference.

## References

- Local product reference: `../margin/README.md` and its public product documentation.
  Refer to documented and observable behavior, not source implementation.
- Local stack example: `../zendo.sh`, particularly its desktop build setup and system-webview
  composer integration. Read its local instructions before borrowing patterns.
- [Electrobun cross-platform development](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)
- [Electrobun browser DOM integration](https://framework.blackboard.sh/electrobun/apis/ui/browser-dom/)
- [Cottontail](https://github.com/blackboardsh/cottontail)
- [CodeMirror guide](https://codemirror.net/docs/guide/) and [reference](https://codemirror.net/docs/ref/)
- [WebView2 Evergreen and Fixed Version distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version)

Framework details above are planning assumptions informed by the initial discussion.
Check current primary documentation and actual pinned packages before implementation.
