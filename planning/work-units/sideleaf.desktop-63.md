# Sideleaf 63 — semantic activity on reload

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/63>
Follow-up: <https://github.com/kortexa-ai/sideleaf.desktop/issues/61>

## Contract

Explicit Reload and automatic clean-document reload publish semantic changes through
the existing bounded activity journal before a waiter observes the reloaded buffer.
Message, thread and suggestion attribution embedded in the reloaded document remains
the event actor; changes without embedded attribution use the explicit `external`
fallback rather than the local OS user. The cursor, filters and event shapes from #61
remain unchanged. External source-only and anchor-relocation reloads stay quiet, like
ordinary editor typing; an externally imported review change wakes the relevant wait.

Recovered named drafts are separate untitled documents with new session document IDs.
Agents enumerate current buffers with `sideleaf documents` and address the recovered
copy by exact ID instead of assuming the original path resolves to recovery content.

## Validation

- Deterministic journal coverage proves a reloaded external thread wakes a waiter and
  retains embedded author/edit attribution.
- Renderer wiring coverage proves explicit and automatic reload use the same activity
  publication path.
- Native macOS and Windows acceptance reloads an external semantic change into an
  already-open clean document and observes it through one scoped wait.

## Acceptance

Implemented and accepted at
`b386afe37948df6acc7a969ce60cda30cb2c4bea` on macOS and Windows.

- macOS validation passed 141 tests; Windows validation passed 138 tests with
  the three expected platform skips. Native builds, packaged CLI checks and
  packaged runtime smoke passed at the identical SHA on both platforms.
- Clean automatic reloads kept source-only and anchor-only changes quiet. An
  external Unicode reply produced one scoped event with its exact embedded actor,
  thread ID and message ID on macOS, native Windows/CMD and a WSL-native file.
- Inactive-buffer reloads produced the same event without activating the target
  or changing the active document identity. Explicit Reload after an external
  conflict kept the human draft and wait untouched until native Discard Changes,
  then loaded the exact disk source and published the imported reply once.
- The recurring intermittent blank macOS cold launch is tracked separately in
  #64. Relaunching the identical bundle succeeded; this work unit makes no claim
  to fix that startup symptom. No release was made.
