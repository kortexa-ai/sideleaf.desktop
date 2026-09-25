# Release procedure fixes from v0.1.10

Work: [desktop #76](https://github.com/kortexa-ai/sideleaf.desktop/issues/76).

`internal/RELEASE.md` now says to rebuild the runtime-sources archive for each
release with the same inputs, a renamed top folder, an updated `BUILDING.md`
that points to the WebKit source release, and a regenerated inner
`SHA256SUMS.txt`. It also says to move the website rollback copy on Smarty
outside the checkout, so that the next deployment passes the clean-checkout
check. Both lessons come from the v0.1.10 release (#75).
