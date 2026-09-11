# Sideleaf development

- Read `PLAN.md` before implementation. Preserve its separation between committed
  product direction, provisional library choices, and deferred features.
- Keep the canonical product plan in `PLAN.md`; use GitHub issues for execution state.
- Prefer mature JavaScript editor and Markdown libraries over building a text engine.

## Cross-platform validation

- Use Bun and the pinned Electrobun/Hutch toolchain. For changes affecting the
  app, run `bun run validate` and build on both native macOS (Snappy) and native
  Windows (Scrappy), then exercise the changed behavior in each desktop app.
  Tests or a build under WSL establish Linux behavior, not Windows acceptance.
- Before testing, inspect the checkout's status, branch, origin and commit.
  Synchronize clean checkouts through Git only (`fetch`, then `pull --ff-only`),
  never copy repository files with scp/rsync or reset someone else's edits.
  Record the exact source SHA on each machine and rebuild after synchronization;
  an already-open app can still be running an older build. Validate locally
  before pushing a candidate for Windows testing; complete both-platform checks
  before calling the work done or cutting a release. Report unavailable checks.
- `ssh scrappy` lands in **WSL**, not PowerShell. The Windows checkout is
  `C:\src\sideleaf.desktop`, visible in WSL as `/mnt/c/src/sideleaf.desktop`.
  Use WSL Git there when Windows Credential Manager is unavailable over SSH.
  Run installs, SDK preparation, tests and builds with **Windows Bun**, not the
  `bun` found in WSL. From the WSL shell:

  ```sh
  /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -Command '
    Set-Location C:\src\sideleaf.desktop
    $env:Path = "C:\Users\francip\.bun\bin;" + $env:Path
    bun install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    bun run prepare:devkit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    bun run validate; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    bun run build; exit $LASTEXITCODE
  '
  ```

  When wrapping PowerShell in SSH, use a quoted heredoc or a UTF-16LE
  `-EncodedCommand` so neither shell expands PowerShell `$variables`.
- For UI tests, use **Windows App** on Snappy to reach the logged-in Scrappy
  desktop. In its PowerShell terminal, `cd C:\src\sideleaf.desktop` and run
  `C:\Users\francip\.bun\bin\bun.exe start`, or open the freshly built
  `C:\src\sideleaf.desktop\build\dev-win-x64\Sideleaf-dev\bin` folder in Explorer
  and launch `launcher.exe`. Preserve existing drafts and close the old test
  instance first. A process started directly through WSL SSH can land in
  non-interactive session 0; a PID alone is not proof of a visible working app.
  Use the available UI-control tool for launch and interaction, and verify the
  intended build, native dialogs and Windows shortcuts in the visible window.
- Release checks additionally follow [docs/releasing.md](docs/releasing.md),
  including actual installer and packaged-CLI tests on both platforms.
