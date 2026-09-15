# Runtime scratch outside the signed macOS bundle

Work: [desktop #56](https://github.com/kortexa-ai/sideleaf.desktop/issues/56).

The pinned runtime creates scratch before evaluating application code. Both
native macOS entry points set `COTTONTAIL_TMP_DIR` before starting Cottontail.
The GUI adapter delegates to the packaged Electrobun launcher; the CLI retains
its caller's working directory and arguments. Scratch uses a private, owned,
non-symlink directory below the macOS per-user temporary directory.

The build installs the adapters before signing. Validate strict signatures
before and after GUI launch and bundled CLI execution, then verify native
Open/Save and CLI relative paths. Runtime upgrades must recheck whether this
adapter is still needed. Windows keeps its existing launchers.
