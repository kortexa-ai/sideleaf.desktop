# Sideleaf #75 — v0.1.10 release

Work: [desktop #75](https://github.com/kortexa-ai/sideleaf.desktop/issues/75).

- Tag one fully validated `main` revision as `v0.1.10`. Follow `internal/RELEASE.md`.
- Includes #70, #71, #49, #52 and #56.
- `bun.lock` and `scripts/third-party-sources.json` are unchanged since v0.1.9,
  so the runtime-sources archive is reused byte for byte.
- The WebKit source is linked from the release body (`webkit-source-27877cc2`)
  and is not uploaded.
- The release also updates sideleaf.xyz and deploys it to Smarty.
