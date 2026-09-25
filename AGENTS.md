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

If you work for the kortexa.ai dev team (for example Astra, Fable or another
Kortexa agent on Snappy or Scrappy), read these documents before you test or
release. Other contributors and their agents can skip them.

- [internal/TESTING.md](internal/TESTING.md): the Snappy/Scrappy build and
  UI-test procedure, including computer use through the Windows App session.
- [internal/RELEASE.md](internal/RELEASE.md): how to publish a GitHub release.
