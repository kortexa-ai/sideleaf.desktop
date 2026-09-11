# Sideleaf desktop #46 — Document I/O and autosave

Issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/46>

## Decisions

- Polling compares document and sidecar stat fingerprints before reading bytes.
  Reuse the last successful content comparison while the fingerprints match,
  whether the result is clean or conflicting. Failed reads remain retryable.
- External edits, content restoration, reload and successful saves update the
  relevant comparison baseline. Explicit content checks and saves continue to
  compare current bytes, independently of the poll cache.
- Autosave leaves typing enabled and records the transferred snapshot as the
  saved baseline. Changes made during transfer remain unsaved in both the editor
  and native host.
- Same-path saves reuse the verified bytes as their disk baseline and avoid
  redundant hashes without weakening conflict checks.

## Validation

- Run the repository typecheck and test suite on macOS and Windows.
- Cover repeated clean and conflicting polls, restoration, same-size edits with
  preserved mtime, sidecar changes, failed reads and recovery, reload and saves.
- Count document reads and hashes on a 10 MiB fixture: unchanged poll results
  must perform neither, including while a conflict is pending.
- Run the packaged Cottontail smoke test on both platforms to check native
  filesystem behavior, preservation and conflict handling.
