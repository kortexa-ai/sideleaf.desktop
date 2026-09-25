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
- Release checks additionally follow [docs/releasing.md](docs/releasing.md),
  including actual installer and packaged-CLI tests on both platforms.

## Kortexa internal

Snappy is the macOS machine. Scrappy is the Windows 11 laptop. Validation runs
on both; see the rules above.

### Build on Scrappy

- `ssh scrappy` lands in **WSL**, not PowerShell. The Windows checkout is
  `C:\src\sideleaf.desktop`, visible in WSL as `/mnt/c/src/sideleaf.desktop`.
  Synchronize it with WSL Git (`fetch`, then `pull --ff-only`) and record the SHA.
- Run installs, SDK preparation, tests and builds with **Windows Bun**, not the
  `bun` found in WSL:

  ```powershell
  Set-Location C:\src\sideleaf.desktop
  $env:Path = "C:\Users\francip\.bun\bin;" + $env:Path
  bun install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  bun run prepare:devkit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  bun run validate; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  bun run build; exit $LASTEXITCODE
  ```

- Send that script from Snappy as a UTF-16LE `-EncodedCommand`, so that no shell
  expands the PowerShell `$variables`:

  ```sh
  ENC=$(iconv -f UTF-8 -t UTF-16LE < build.ps1 | base64 | tr -d '\n')
  ssh scrappy "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -EncodedCommand $ENC"
  ```

  Piping a script to `powershell.exe -Command -` over SSH runs nothing and
  exits 0. SSH stdin into WSL is also unreliable. To send a file or script,
  pass it as a base64 argument (`ssh scrappy "echo $B64 | base64 -d > /tmp/x"`).
- In the Windows test output, `The Sideleaf channel ACL is not private to this
  Windows user (Windows error 5)` is expected output from a passing channel
  test.

### UI test on Scrappy

- A process started through WSL SSH lands in non-interactive session 0 and is not
  visible. Launch the app from inside the logged-in desktop instead.
- Snappy's **Windows App** (`com.microsoft.rdc.macos`) keeps a `scrappy` remote
  desktop session. An agent with computer use requests access to **Windows App**
  and drives Scrappy's desktop through it. Claude Code saves its `computer-use`
  MCP enable per project directory. Enable it with `/mcp` in the directory
  where the session starts.
- In the remote desktop, the taskbar terminal opens an Ubuntu (WSL) tab. That
  tab belongs to the visible session, so Windows programs started there show on
  the desktop:

  ```sh
  /mnt/c/src/sideleaf.desktop/build/dev-win-x64/Sideleaf-dev/bin/launcher.exe --sideleaf-open 'C:\path\to\file.md' &
  ```

  Omit `--sideleaf-open PATH` to open the app with no document.
  Running `C:\Users\francip\.bun\bin\bun.exe start` in `C:\src\sideleaf.desktop`
  from a PowerShell tab also works, and so does launching `launcher.exe` from
  `C:\src\sideleaf.desktop\build\dev-win-x64\Sideleaf-dev\bin` in Explorer.
- Use Windows shortcuts (`ctrl+s`, `ctrl+end`) in the remote session. Type
  single-line text and press Return as a separate key: multi-line typing uses
  the clipboard and can fail over the remote session.
- Keep test fixtures outside the checkout, for example in
  `C:\Users\francip\sideleaf-qa`. Check the saved bytes over SSH with `xxd`.
- Close the test instance with its window close button. Preserve existing
  drafts, and close an older instance before starting a new build.
