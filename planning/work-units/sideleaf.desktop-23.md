# Sideleaf #23 — v0.1.2 release

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/23>

## Release contract

- Tag the exact validated `main` revision as `v0.1.2`.
- Build the macOS arm64 distribution with Developer ID signing, app and DMG
  notarization, stapling, Gatekeeper checks, and packaged CLI validation.
- Build the native Windows x64 setup archive, validate its packaged CLI, and
  retain the documented unsigned-installer status.
- Publish both installers, combined SHA-256 checksums, third-party sources, and
  third-party notices on one stable GitHub release.
- Verify the public release and anonymous asset downloads before changing the
  website download targets.

## User-facing highlights

- Native custom title bars and reliable hamburger menus on macOS and Windows.
- A responsive botanical empty state, compact toolbar controls, settings, and
  keyboard shortcuts for views, find, and comments.
- Thirty-second autosave plus durable recovery of one untitled draft across
  application restarts.
