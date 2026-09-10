# Sideleaf #43 — v0.1.4 release

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/43>

## Release contract

- Tag the exact validated `main` revision as `v0.1.4`.
- Build the macOS arm64 distribution with Developer ID signing, app and DMG
  notarization, stapling, Gatekeeper checks, and packaged CLI validation.
- Build the native Windows x64 setup archive, validate its packaged CLI, and
  retain the documented unsigned-installer status.
- Install the final signed macOS app after moving prior builds to Trash.
- Publish both installers, combined SHA-256 checksums, third-party sources, and
  third-party notices on one stable GitHub release.
- Verify the public release and anonymous asset downloads before updating the
  website.

## User-facing highlights

- Light, dark, and system appearance modes.
- Distraction-free mode, document zoom, and platform-correct custom shortcuts.
- Minimal layout with compact title-bar document and Comments controls.
- Refined hamburger menu and themed keyboard shortcut reference.
- Markdown file registration and command-line tools on macOS, Windows, and WSL.

## Validation

- Run the full test suite on macOS and Windows.
- Test the signed macOS distribution and the Windows setup archive before
  publishing.
- Record artifact checksums, signing checks, packaged CLI checks, and public
  download verification here.
