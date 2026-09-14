# Sideleaf #67 — v0.1.9 release

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/67>

## Release contract

- Tag one fully validated `main` revision as `v0.1.9`.
- Build and test the native macOS arm64 and Windows x64 distributions from that
  exact revision, including the packaged runtime, CLI, installers and desktop UI.
- Verify Developer ID signing, notarization, stapling and Gatekeeper on macOS.
  Keep the documented unsigned Windows distribution status.
- Publish the tested installers, combined checksums, notices and required source
  archives, then verify the public asset inventory and downloaded hashes.

## Release notes

This patch updates Sideleaf to the new Electrobun beta for improved Windows
stability and compatibility. There are no additional user-facing features after
v0.1.8; the other intervening change only clarifies internal release evidence.
