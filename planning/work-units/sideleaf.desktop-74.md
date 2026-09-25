# Kortexa internal testing and release documents

Work: [desktop #74](https://github.com/kortexa-ai/sideleaf.desktop/issues/74).

`AGENTS.md` keeps the portable validation rules and a short "Kortexa internal"
section that sends team agents to `internal/TESTING.md` and
`internal/RELEASE.md`. Other contributors can skip them. The release procedure
was reconstructed from the v0.1.8 and v0.1.9 release sessions. It includes the
decision that the WebKit corresponding source is a one-time
`webkit-source-<sha>` pre-release that each release body links to. The public
`docs/releasing.md` keeps the general requirements. The documents name
Keychain profiles and variables only, never credential values.
