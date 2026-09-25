# Kortexa internal testing

This is the kortexa.ai team procedure for the cross-platform validation that
[AGENTS.md](../AGENTS.md) requires. Snappy is the macOS machine (Apple Silicon).
Scrappy is the Windows 11 x64 laptop. Both are on the team LAN.

## Order of work

1. Validate and build on Snappy: `bun run validate`, then `bun run build`.
2. Push the candidate to `origin/main`. Scrappy synchronizes only through Git.
3. Build and validate on Scrappy (see below). Record the SHA on each machine.
4. Exercise the changed behavior in the visible desktop app on both machines.
   On Snappy, launch the dev build with its bundled CLI:
   `build/dev-macos-arm64/Sideleaf-dev.app/Contents/MacOS/sideleaf open FILE --app build/dev-macos-arm64/Sideleaf-dev.app`.
5. Put the evidence (SHAs, test counts, observed behavior) in the GitHub issue.


## Build on Scrappy

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
- `scp` to and from Scrappy fails with "Connection closed". To copy a build
  artifact to Snappy, stream it as base64 and compare SHA-256 on both sides:
  `ssh scrappy 'base64 -w 0 /mnt/c/src/sideleaf.desktop/artifacts/release/FILE' | base64 -d > artifacts/release/FILE`.
- In the Windows test output, `The Sideleaf channel ACL is not private to this
  Windows user (Windows error 5)` is expected output from a passing channel
  test.

## UI test on Scrappy

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
