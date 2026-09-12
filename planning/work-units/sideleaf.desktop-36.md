# Sideleaf 36 — launcher and running-instance delivery

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/36>
Program design: [sideleaf.desktop-59.md](sideleaf.desktop-59.md)

## Contract

The installed `sideleaf` command has three desktop entry forms:

- `sideleaf` starts Sideleaf or activates its existing window; `--app PATH`
  selects a specific dev or stable build for this form.
- `sideleaf FILE` and `sideleaf open FILE` open one existing document.
- `sideleaf open-folder DIRECTORY` opens one existing folder workspace.

`--help` is headless and writes stable help text to stdout. Desktop commands write
one JSON result. Invalid input writes one JSON error to stderr and returns a nonzero
status. A bare path is an `open` shorthand only when it is not a named command.

## Instance delivery boundary

Each app channel publishes one random local endpoint beneath its private user-data
root. The endpoint greets a client with its instance and process identity before the
client sends the private bearer value or a document path. Requests are bounded and
carry an ID. A live but unresponsive or mismatched owner fails closed.

macOS uses Launch Services file operands for a cold file open and for compatibility
with an already-running build. The `-n` new-instance flag is not used. Windows and
WSL use the local channel when the app is running and the native launcher when it is
absent. The app itself arbitrates simultaneous Windows starts with an exclusive named
pipe; macOS uses the system `shlock` owner primitive and Launch Services activation.
Explicit `--app` selection derives the matching dev or stable channel from the app's
packaged version metadata.

The running app puts delivered paths through the same renderer-owned leave flow as
File → Open. A dirty document therefore keeps its existing Save, Cancel and Discard
behavior. Pending opens use a queue, so one request cannot overwrite another before
the renderer handles it.

## Acceptance

- Focused tests cover no-argument activation, bare-path shorthand, Unicode paths,
  concurrent instance handoff, private Unix socket modes, endpoint mismatch, timeout,
  folder launch markers and headless help.
- The packaged CLI repeats help and running-channel checks with Node and Bun removed
  from the child PATH.
- Native macOS and Windows acceptance completed against code commit
  `8b38dfafc7f4c0e417382fa4f0896b69761c571a`. Both platforms built with the pinned
  toolchain, and their packaged CLIs ran with Bun and Node absent from `PATH`.
- The visible macOS app passed cold Unicode/spaces file launch, running-instance
  delivery, no-argument activation and dirty Save/Cancel/Discard behavior.
- The visible Windows app passed cold no-argument and exact Unicode/spaces file launch
  through `--app`, then delivered a duplicate open to the running instance without
  changing the live document ID or opening a second buffer. Native CMD and the
  production-equivalent WSL wrapper also passed running delivery, dirty-buffer
  lifecycle behavior and Windows-drive/WSL-native path translation.
- Focused tests keep dev and stable channel roots isolated. No release was cut as part
  of this work unit.
