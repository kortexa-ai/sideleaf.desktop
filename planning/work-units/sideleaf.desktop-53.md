# Single line breaks setting

Owning issue: <https://github.com/kortexa-ai/sideleaf.desktop/issues/53>

Keep the preview-only line-break preference off by default and persist it with
the other application settings. Explain the Markdown rendering difference in
the adjacent info button's tooltip. Align the label and icon with a shared flex
cross-axis instead of a baseline offset, so platform font metrics cannot push
the icon below its label. Preserve the tooltip and independent switch behavior.

Validate renderer behavior with the Markdown tests. Check label/icon alignment
and tooltip behavior in the native Settings panel without changing the document.
