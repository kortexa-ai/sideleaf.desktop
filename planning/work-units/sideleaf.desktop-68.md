# Sideleaf #68 — WebKit source consolidation

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/68>

## Delivery contract

- Publish one revision-addressed prerelease containing the exact WebKit source
  archive shared by Sideleaf v0.1.0 through v0.1.9.
- Link every affected Sideleaf release directly to the canonical archive without
  changing Sideleaf version tags, release ordering, or Latest status.
- Remove only the ten byte-identical version-named WebKit archive assets and
  their obsolete checksum lines. Preserve all installers, runtime sources,
  notices, and other release assets.
- Verify the canonical archive through an anonymous download, then verify every
  affected release body, asset inventory, checksum file, and Latest selection.

## Fixed source identity

- WebKit commit: `27877cc2acd8a3cea8b3827ddb48d6c6c0177714`
- Archive SHA-256: `d1fe3fbe5195aeecd39bd576b1ac68ed6e3a5b0e1f3b8c27399ab89210d379ca`
- Archive size: `1,066,116,094` bytes
