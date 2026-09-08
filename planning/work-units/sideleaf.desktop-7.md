# First public release

The [release work](https://github.com/kortexa-ai/sideleaf.desktop/issues/7) and
[website launch](https://github.com/kortexa-ai/sideleaf/issues/2) share the v0.1.0
download contract. Sideleaf's own source uses MIT. The first binaries target
Apple Silicon macOS and x64 Windows.

Release packaging applies the existing Windows runtime adapter before compression
and signs and notarizes macOS installers. Update checks use GitHub Releases with
a daily automatic limit, a manual menu action, and a dismissible notice.
The website privacy policy describes these requests and local diagnostic files.

The product roadmap remains in `PLAN.md`. Release validation and publication
evidence belongs in the owning issue.
