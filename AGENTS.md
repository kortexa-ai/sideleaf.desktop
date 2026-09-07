# Sideleaf development

- Read `PLAN.md` before implementation. Preserve its separation between committed
  product direction, provisional library choices, and deferred features.
- Implement Sideleaf independently. Use Margin's documented behavior and observable
  product as a reference; do not copy or port its source code or internal architecture.
- Use `../zendo.sh` as an example of Electrobun/Cottontail setup and platform integration.
  Recheck its current instructions and exact dependency versions when using it.
- Prefer mature JavaScript editor and Markdown libraries over building a text engine.
- Start with system webviews. Warren, a custom GPU text renderer, and bundled Chromium
  require a concrete measured need and an explicit architecture decision.
- Protect literal Markdown, undo/redo, composition input, atomic saves, and external
  change handling. Test these through the real packaged app as well as isolated logic.
- Keep secrets and generated build artifacts ignored. Use npm for project scripts.
- Keep the canonical product plan in `PLAN.md`; use GitHub issues for execution state.
