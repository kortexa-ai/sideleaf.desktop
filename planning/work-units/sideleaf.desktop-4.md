# Windows runtime idle CPU

Work item: https://github.com/kortexa-ai/sideleaf.desktop/issues/4

Isolate the high idle CPU observed in the pinned Windows Cottontail runtime.
Compare a timer-only process with the packaged app, then distinguish native
polling, JavaScript scheduling, and garbage collection before selecting a fix.
Keep the editor and system-webview architecture intact.

Use the Sideleaf checkout and generated fixtures on Scrappy. Measure only exact
Sideleaf process identities; preserve Harmonizer and unrelated profiling sessions.
Record the runtime pins, reproducer, repeated settled CPU intervals, and limits.
Any runtime change must pass real open, edit, save, and external-change checks.
