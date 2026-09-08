# Windows runtime CPU verification — 2026-09-07

This pass used Scrappy, Windows 11 build 26200, WebView2 152.0.4191.66,
Cottontail 0.6.0-canary.14 (`e5ddf52648c502b1b124ec5f41a9b87b7b9ecedb`),
and Electrobun 2.0.2-beta.15. It follows the [size and file-safety pass](performance-2026-09-07.md)
and is tracked in [issue 4](https://github.com/kortexa-ai/sideleaf.desktop/issues/4).

## Cause and adapter

A timer-only Cottontail process consumed about four CPU seconds in a ten-second
idle interval. Its loop wake rate was normal and its JavaScript heap was small.
Sampling only that process's busy thread identified the page-touch loop in
JavaScriptCore's `VM::updateStackLimits` / `preCommitStackMemory`.

[Cottontail reserves a 128 MiB script-thread stack](https://github.com/blackboardsh/cottontail/blob/e5ddf52648c502b1b124ec5f41a9b87b7b9ecedb/src/script_runner.zig#L17).
[The pinned JSC Windows implementation](https://github.com/WebKit/WebKit/blob/27877cc2acd8a3cea8b3827ddb48d6c6c0177714/Source/JavaScriptCore/runtime/VM.cpp#L1083)
touches stack pages when its soft limit changes. VM entry and exit repeatedly
changed that limit. Setting `JSC_maxPerThreadStackUsage=134217728` before VM creation
keeps the limits consistent. JSC still applies the native stack bounds and its
reserved guard zone. A `.env` file did not set this option early enough.

The development package now has a 153,088-byte native Windows launcher, including
Sideleaf's icon. It sets the option for its child process and calls the preserved
Electrobun launcher. It imports only KERNEL32 and USER32; it adds no C runtime or
managed runtime. The packaging script checks the exact Cottontail revision and
original launcher hash. Revisit the adapter when either runtime changes.

The launcher test used a directory and arguments containing spaces, accents,
CJK characters and emoji. It preserved the child argument and exit code 23,
set the child option, and left the parent's environment unchanged. The compiler
is Zig 0.16.0, cached under `tmp/toolchain`; its download is checked against the
[official archive checksum](https://ziglang.org/download/index.json). It is not
included in the app.

## CPU results

CPU seconds are `Process.TotalProcessorTime` deltas. Ten CPU seconds over ten wall
seconds means one fully occupied core, regardless of the machine's core count.
Thread sampling ran after the measured interval.

| Process | CPU seconds | Wall seconds |
| --- | ---: | ---: |
| Timer-only runtime, original setting | 4.03125 | 10.01773 |
| Timer-only runtime, matched stack limit | 0.03125 | 10.01071 |
| Timer-only runtime, matched limit and `--smol` | 0.046875 | 10.00498 |
| Empty app, previous pass | 9.9375 | about 10 |
| Rebuilt empty app, first interval | 0.21875 | 10.01382 |
| Rebuilt empty app, second interval | 0.015625 | 9.99443 |
| Rebuilt empty app, third interval | 0.09375 | 10.00427 |

The last two app intervals used about 0.16% and 0.94% of one core. These are sampled
intervals, not a guaranteed upper bound during startup, editing, or file access.
This pass does not establish a matched Windows memory or cold-start improvement.

The final Windows package contains 82,101,006 file bytes (78.30 MiB), compared with
84,720,284 bytes before the size pass. It contains multiple runtime and resource
files, not a single executable. The macOS package remains about 73 MiB.

## File and application checks

The isolated 9 MB file benchmark ran against the packaged Cottontail executable
with the stack setting enabled. These are single cached-file runs, not latency
percentiles or input-to-paint measurements.

| Operation | Previous Windows run | With the stack setting |
| --- | ---: | ---: |
| Open | 262.69 ms | 55.37 ms |
| External-change check | 186.74 ms | 22.73 ms |
| Save | 875.29 ms | 156.43 ms |

Validation passed: 16 tests on macOS; 15 tests and one POSIX-only skip on Windows,
plus type checking. The rebuilt Windows app also passed real native UI checks:

- Open and Save As with Unicode paths; Ctrl+S, Ctrl+Shift+S, undo and redo.
- Exact UTF-8 BOM, CRLF, accents, CJK text and emoji preservation.
- Reopen an anchored comment and retain it through Save As and conflict copying.
- Detect an external write while dirty, refuse normal Save, preserve the external
  writer, and save the draft with its matching comment revision to a separate file.
- Open, edit and save the large fixture. The resulting 9,000,022 bytes exactly
  match the expected source. SHA-256:
  `21b94b451170b1d4d4a2cd6666765a4546855575edac8b527aae397e146336c1`.
- Display the expected 1,531,920 words and aligned line numbers in the large-file
  view. Placeholder and wrapped-line alignment were checked in the preceding pass.
- Quit cleanly. A separate recursive-call probe caught `RangeError` with the new
  stack setting; it did not crash the native process.

All Sideleaf test processes exited and the two temporary scheduled tasks were
removed. Harmonizer's launcher and runtime retained their original process IDs
and start times throughout the checks.

Some WebView2 buttons did not expose an actionable UI Automation pattern during
this run; the checks used normal keyboard navigation for those controls. This is
not screen-reader acceptance. Clean-install, signing and broader IME/accessibility
coverage remain part of the prototype's distribution work.

## Repeating the runtime measurements

After a Windows build, run `scripts/windows-idle.ps1` in native PowerShell with
Sideleaf closed. It starts and measures only the checkout's Cottontail executable.
Use `-SampleThread` for a bounded instruction-address sample of its busiest thread.
The probe imports no application modules and writes its results under `tmp/qa`.
To compare the configured setting, set `JSC_maxPerThreadStackUsage` to `134217728`
in that PowerShell process before running the probe. Do not set a user-wide or
machine-wide environment variable. Launch the packaged `bin/launcher.exe` to test
the complete app with the automatic adapter.
