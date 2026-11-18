# Sideleaf #82 — folder launch paths

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/82>

## Scope

Open a folder as a workspace when its path reaches Sideleaf through
`sideleaf DIRECTORY`, `sideleaf open DIRECTORY`, a launch argument or the launch
environment. `open-folder` keeps working and still requires a directory.

## Decisions

- The CLI checks the filesystem type. A directory given bare or to `open` sends
  the same `open-folder` request as `open-folder`, with the same output shape.
  `open-folder FILE` remains a usage error.
- `launchRequestFromLaunch` checks whether the requested path is an existing
  directory before it trusts the marker or `SIDELEAF_OPEN_KIND`, as #79 does for
  native open-URL activation. A folder can itself end in `.md`.
- A missing path keeps its marked kind, so the normal open-error flow reports it.
- Folders dropped into the window and Windows folder shell registration remain
  out of scope.

## Validation contract

- Cover bare, `open` and `open-folder` delivery of directories through a running
  app channel, including a name with a space and non-ASCII characters and a folder
  named `something.md`. Keep `open-folder FILE` and missing paths as errors.
- Cover launch markers and environment kinds for existing directories, files and
  missing paths.
- Run `bun run validate` and a development build. Native macOS and Windows checks
  of the command against the visible app are done separately.
