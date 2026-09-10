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

## Result

- Tagged release source commit `c44a045fd5349d200b158d284eefb476baa8616a`
  as `v0.1.4`.
- macOS validation passed 56 tests. The app and DMG passed deep signature,
  notarization, staple, Gatekeeper, and packaged CLI checks. Apple accepted app
  submission `f5f467dd-e56d-44fb-b66d-5c67d6b612e8` and DMG submission
  `b731ad9a-1def-4385-b948-f303589301e1`.
- Installed the final signed app at `/Applications/Sideleaf.app`. The replaced
  0.1.4 build remains recoverable at
  `~/.Trash/Sideleaf-0.1.4-before-final.app`.
- Windows validation passed 53 tests with 3 expected platform skips. The final
  setup, installed CLI, launcher version metadata, Markdown picker name, file
  activation, hamburger menu, shortcut popup, and Minimal layout passed on
  Scrappy. The setup and installed launcher remain unsigned as documented.
- Published the stable release at
  <https://github.com/kortexa-ai/sideleaf.desktop/releases/tag/v0.1.4> with six
  assets. Anonymous HTTP checks returned 200 for every asset, and GitHub's asset
  digests matched the local checksums.
- Third-party dependency locks did not change from 0.1.3, so the matching runtime
  and WebKit source bundles were reused under the 0.1.4 names.

| Artifact | SHA-256 |
| --- | --- |
| `Sideleaf-0.1.4-macos-arm64.dmg` | `38c0849b2e2b8ac5788e305b2177c615ec8d245ed1cbc56de6802d5626e6d6f0` |
| `Sideleaf-0.1.4-windows-x64-setup.zip` | `12d14a3bfb4a334fcdb3c572a7bacd03c0118d47bcc9cd980d6e06061c825098` |
