# Kortexa internal build and UI-test notes

Work: [desktop #73](https://github.com/kortexa-ai/sideleaf.desktop/issues/73).

`AGENTS.md` keeps the portable cross-platform validation rules. A separate
"Kortexa internal" section gives the Snappy/Scrappy procedure: the Windows Bun
build through PowerShell `-EncodedCommand` over SSH, and the UI test through
computer use of the macOS Windows App remote session. The procedure was proven
while verifying #70 and #71.
