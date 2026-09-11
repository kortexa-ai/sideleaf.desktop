# Markdown folders and vault navigation

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/38>
Product direction: [PLAN.md](../../PLAN.md#folder-navigation)

## Agreed scope

Expose the full hierarchy beneath one folder root, not just the directory of
the current note. Keep child folders collapsed until expanded, except for the
ancestors needed to reveal the active file. Enumerate lazily; do not load every
Markdown document or build an index before showing the tree.

| Entry point | Root | Initial sidebar |
| --- | --- | --- |
| Open Folder | The folder explicitly selected | Visible |
| Open a single file | Its containing folder, first enumerated when the user shows the tree | Hidden |
| New with no open folder or saved path | None | Hidden; folder button disabled |
| Navigate to another file within the tree | Keep the chosen root | Preserve current visibility |

The icon toggles visibility; it does not open a folder picker. Add **Open Folder…**
to the normal opening actions, the Minimal File menu and the native File menu.
It remains available on the empty/new-document screen. Add an explicit CLI
`sideleaf open-folder DIRECTORY` command, keeping existing file-open arguments
unambiguous and coordinating later shorthand with #36.

Use Command-Shift-F on macOS and Control-Alt-F on Windows. Place the icon-only
folder button immediately before Comments in Minimal layout, and between the
Write/Split/Read control and Comments in full layout. Give it a visible active
state, an accessible Show/Hide Folder label, expanded state and shortcut tooltip.
Include the action in the keyboard-shortcut reference and View menu. Route menu
and key commands through one action so one key press cannot toggle twice. Check
composition, repeats, dialog focus, and non-US/AltGr input on real platforms.

Hiding the tree preserves its root, expansion state, scroll, selection and open
buffers. The initial defaults apply to a new open context, not each file switch
or layout change. Folder creation is explicitly deferred to
[#54](https://github.com/kortexa-ai/sideleaf.desktop/issues/54).

## One product clarification before implementation

Franci requested that the folder button be disabled for a new file. Keep that
rule for a standalone untitled document. The remaining case is **New inside an
already open folder**. Recommended: retain the workspace and let its sidebar
stay available; an untitled buffer should not strand the user outside the tree.
This exception is a proposal pending confirmation, not an accepted change to
the requested disabled state. An empty folder view itself is not an unsaved New
document: it still needs a working sidebar toggle and Open Folder action.

## Proposed defaults for the remaining edges

- Keep an explicitly chosen root fixed, including after Save As or opening a
  file outside it. Show outside-root and untitled buffers in a compact **Open
  documents** section rather than losing navigation to them. For a standalone
  file context, Save As follows the new containing folder without reopening a
  sidebar the user hid. Switching files from its tree promotes that root to a
  stable workspace root rather than following each child file's parent.
- Open Folder shows the tree without automatically opening an arbitrary first
  file. After the normal leave-workspace checks, show a Choose a file state.
  Empty, unavailable and permission-denied folders have distinct messages and
  retain Open Folder/retry actions.
- New inside a workspace creates an untitled buffer and preserves other open
  buffers. Its first Save As starts in the selected directory, or the root when
  no directory is selected. This uses existing New/Save As; it does not add
  folder creation or write a placeholder file silently.
- List folders first, then supported text documents in stable natural-name
  order. Match the app's current supported extensions. Keep dot-directories and
  known internal directories such as `.obsidian`, `.git` and `node_modules` out
  of the initial view. Do not prune apparently empty folders using a full
  recursive scan. Images and other attachments are outside the first editor
  tree; do not imply that they are absent from disk.
- Highlight and reveal the active file without collapsing unrelated branches.
  Support arrow-key expansion/navigation, Home/End, type-to-select and Enter to
  open. Keep file selection distinct from keyboard focus; closing the panel
  returns focus to the editor/reader. Show dirty, conflict and missing-file states.
- Make the panel resizable, with bounded width retained across layout changes.
  On narrow windows, use a temporary drawer instead of squeezing the editor and
  Comments into unusable columns. Closing that drawer preserves workspace state.
  Distraction-free mode temporarily hides both sidebars and restores their
  previous visibility on exit. An explicit Folder shortcut can leave that mode
  and reveal the folder panel. Future pinned documents (#39) remain separate.
- Rename and Trash apply to files in this first pass. Keep folder rename/move,
  recursive deletion, drag-and-drop moves, creation, tabs, multiple roots and
  full workspace session restoration outside this work unit. A future folder
  creation decision must not grow into those operations by implication.

## Implementation sequence

1. **Establish document sessions before file switching.** The current host owns
   one `DocumentFile` and `SaveTransfer`; the renderer owns one set of saved
   baselines and replaces CodeMirror state in `applyDocument`. Introduce a
   registry of stable document sessions and an active ID. Preserve each editor
   state, undo/redo, comments, unfinished comment draft, cursor, scroll, saved
   baseline, dirty generation and conflict state. Share one mounted editor and
   one preview. Never evict dirty buffers; bound clean-buffer retention and
   verify memory use without reading all files in a vault.
2. **Make lifecycle and persistence work for every session.** Bind transfers,
   save results, dialogs, cancellation and disk checks to the originating
   document and workspace generation, not whichever document is now active.
   Autosave all eligible dirty buffers fairly without overlapping a document's
   saves or blocking typing. Preserve the content-exact save and cached-poll
   guarantees from #46. Window dirty state reflects any dirty buffer. Close
   Document checks that document; Close Folder, replacing a workspace, native
   close and Quit check all affected buffers. Cancellation leaves the workspace
   intact. Extend local draft recovery to avoid losing hidden unsaved buffers;
   retain original paths/revisions and never replay recovered drafts over disk
   automatically. Migrate the existing single untitled scratch safely.
3. **Add a bounded host workspace service.** Own root identity, per-directory
   listings, document identity and watcher lifetimes in the host. Use typed
   requests for listing, opening, renaming and trashing allowed entries; return
   validated names and IDs rather than an arbitrary filesystem bridge. Resolve
   symlinks/junctions before operations, prevent cycles and traversal outside
   the chosen root, and handle changed paths at use time. Reuse a buffer for
   the same canonical file; cover aliases and case-sensitive WSL directories.
   Debounce watcher events and rescan affected/visible directories, preserving
   selection and expansion. Probe pinned Cottontail watcher behavior on both
   platforms before selecting an adapter; use a bounded refresh fallback for
   unreliable WSL/network watches. A hidden panel must not stop dirty-buffer
   conflict protection.
4. **Wire the sidebar and opening flows.** Implement the tree, Open documents
   section, defaults, empty/error states, toggle, keyboard handling, focus,
   resize/drawer behavior and Full/Minimal/distraction-free layouts. Preserve
   title-bar drag regions and Windows edge resizing. Add native folder picking
   and the packaged CLI command. Use #47's eventual activation/quit contract;
   do not independently reimplement or race those changes.
5. **Add file rename and Trash.** Retain the buffer identity, selection, dirty
   text and revision checks through rename. Check collisions and case-only
   rename behavior. Confirm disposal of unsaved changes before moving a file
   to the OS Trash/Recycle Bin; retain the buffer if trash fails. If recoverable
   deletion is unavailable, disable that action with an explanation instead of
   silently substituting permanent deletion. Handle externally renamed/deleted
   files without discarding drafts or treating an uncertain match as identity.
   Do not add multi-file atomic transactions or automatic link rewriting.

Likely surfaces: `src/main.ts`, `src/shared/contracts.ts`, new document/workspace
modules, `src/document/scratch.ts`, `src/document/save-transfer.ts`,
`src/ui/app.ts`, a focused tree/session UI module, `src/ui/index.html`,
`src/ui/app.css`, `src/ui/shortcuts.ts`, `src/cli.ts`, platform dialog/activation
adapters and corresponding tests. Choose exact implementation surfaces with a
fresh preflight/claim; this planning claim does not authorize code ownership.

## Acceptance and review

- Verify explicit folder versus single-file defaults, root stability, first
  Save As, the decided New-in-workspace behavior, empty folders, layout changes,
  repeated toggle, focus and both platform shortcuts in real packaged apps.
- Edit A, switch to B without a prompt, edit B, return to A: exact text,
  comments, undo/redo, cursor and scroll survive. Exercise a pending comment,
  typing during autosave, switching during a save/dialog, inactive conflicts,
  autosave failure, mixed saved/untitled buffers, Cancel while quitting and
  recovery after interruption. No save result can update a different buffer.
- Cover renames, case-only names, collisions, failed Trash, external deletion,
  inaccessible roots, Unicode, long paths, aliases, symlink/junction escape,
  loop prevention and WSL mode preservation. Root replacement must cancel
  obsolete listings/watchers and ignore their late results.
- Use a large nested fixture to measure startup, expansion latency, watcher
  load and total app memory. Prove opening a root does not load every document,
  and unchanged/hidden tree state causes no document read/hash loop.
- Run repository validation and packaged Cottontail tests on macOS and Windows,
  plus real WSL folder/save/rename checks. Visually inspect Full and Minimal
  layouts, two sidebars, narrow sizes, distraction-free restore and native
  title-bar behavior. Recheck #47's lifecycle tests after integration.

Keep implementation progress, measured results and delivery SHAs in #38. Keep
the durable product decisions in PLAN.md and revise this proposed sequence if
the chosen workspace contract changes.
