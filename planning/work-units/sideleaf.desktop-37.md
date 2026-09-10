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
