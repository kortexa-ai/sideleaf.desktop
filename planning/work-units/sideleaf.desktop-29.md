# Sideleaf #29 — v0.1.3 release

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/29>

## Release contract

- Tag the exact validated `main` revision as `v0.1.3`.
- Build the macOS arm64 distribution with Developer ID signing, app and DMG
  notarization, stapling, Gatekeeper checks, and packaged CLI validation.
- Build the native Windows x64 setup archive, validate its packaged CLI, and
  retain the documented unsigned-installer status.
- Install the final signed macOS app after moving the prior installed build to
  Trash, then verify the installed application and Markdown registration.
- Publish both installers, combined SHA-256 checksums, third-party sources, and
  third-party notices on one stable GitHub release.
- Verify the public release and anonymous asset downloads before changing the
  website download targets.

## User-facing highlights

- Markdown document registration and reliable shell-open handling on macOS and
  Windows.
- Distraction-free Write, Split, and Read modes with keyboard switching.
- Coordinated document zoom with shortcuts and compact footer control.
