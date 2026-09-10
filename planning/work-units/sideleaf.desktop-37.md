# Sideleaf desktop #37 — Agent skill installer

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/37>

## Scope

- Add `sideleaf skills install` for the shared `~/.agents` location, every
  supported user location, or one named harness.
- Ship a small self-contained skill for safe Markdown editing and comments.
- Keep installs atomic and idempotent, and require an explicit option before
  replacing a locally modified skill.
- Put WSL skills in the WSL home instead of the Windows profile.
- Release the result as Sideleaf 0.1.5 on macOS and Windows.

## Validation

- Run type checking and the complete test suite on macOS and Windows.
- Validate the generated skill frontmatter with the skill validator.
- Exercise the packaged CLI with no external JavaScript runtime.
- Install the skill into isolated native and WSL homes, including idempotent,
  single-target, all-target, and modified-file cases.
- Build and inspect the signed/notarized macOS DMG and Windows setup ZIP before
  publishing the release.

## Result

- Tagged tested source commit `8d2e32cdc3498c5e5be97ce8a59e65b4f442e113`
  as `v0.1.5` and published six release assets.
- macOS validation passed 61 tests. The final DMG and installed app passed deep
  signature, Gatekeeper, notarization, staple, packaged CLI, skill install, and
  skill frontmatter checks. Apple accepted app submission
  `86d5d6db-7426-408b-a2d4-d4f13cbfbf35` and DMG submission
  `4dacd7ff-eb39-4678-8b30-24d79fd6da42`.
- Installed the final signed app at `/Applications/Sideleaf.app`. The previous
  0.1.4 app remains recoverable at
  `~/.Trash/Sideleaf-0.1.4-before-0.1.5.app`.
- Windows validation passed 58 tests with 3 expected platform skips. The final
  setup installed 0.1.5 on Scrappy, and the installed native CLI and WSL wrapper
  passed packaged-runtime, all-target, single-target, and idempotency checks.
  The setup and launcher remain unsigned as documented.
- The generated skill passed the skill validator. Modified-file refusal and
  explicit replacement passed automated tests on both native platforms.
- GitHub reported matching digests for every asset, and anonymous HTTP checks
  returned 200 for all six downloads.
- Dependency locks did not change from 0.1.4, so the checksum-matched runtime
  and WebKit source bundles were reused under the 0.1.5 names.

| Artifact | SHA-256 |
| --- | --- |
| `Sideleaf-0.1.5-macos-arm64.dmg` | `3ab9b595dd97f31bc479c28579ad45bc72d1b327ed20d4b9738defdf6e0101d9` |
| `Sideleaf-0.1.5-windows-x64-setup.zip` | `586b74b9db975448296a8f23fe0e27e397283c8e51a8053f337df31c8898ad09` |
