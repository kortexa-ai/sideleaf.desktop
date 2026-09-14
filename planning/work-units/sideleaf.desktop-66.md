# Electrobun beta upgrade

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/66>

Upgrade Sideleaf from Electrobun `2.0.2-beta.15` to the latest public beta.
Keep the dependency exact, regenerate the Bun lockfile and Hutch SDK metadata,
and update only the runtime guards and third-party notices that the new SDK
requires. Review the runtime-trimming allowlist and the Windows launcher adapter
against the generated artifacts instead of weakening either safety check.

## Acceptance

Run `bun run validate` and build at the same source SHA on native macOS and
native Windows. Confirm the generated Electrobun and Cottontail revisions,
verify that runtime trimming still removes only the unused V8 compatibility
pack, and exercise the built app in a visible desktop session on both systems.
Record any unavailable native check instead of treating WSL as Windows proof.
