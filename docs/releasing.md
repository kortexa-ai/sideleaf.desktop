# Releasing Sideleaf

Use native macOS and Windows machines and the committed `bun.lock`. The pinned
runtime currently requires macOS 26.6.2 on Apple Silicon. The Windows release
is tested on Windows 11 x64 and uses the installed WebView2 Evergreen runtime.

## Build

```sh
bun install --frozen-lockfile
bun run prepare:devkit
bun run build:release
```

On macOS, supply a Developer ID Application identity through
`ELECTROBUN_DEVELOPER_ID`. Keep signing credentials in your local secret store or
ignored environment, and never commit them. Hutch signing is enabled for stable
builds; development builds do not use the signing identity. Hutch notarization is
disabled because it cannot consume the release machine's `notarytool` Keychain
profile. The final macOS packaging step submits and staples both the inner app and
the DMG with that profile. Create it with Apple's `notarytool store-credentials`
on a release machine.

On Windows, use native Windows Node 24 or newer and Windows PowerShell.
The build is unsigned. Hutch produces a ZIP containing the setup executable;
users must extract the ZIP before running Setup. The native runtime adapter is
applied before packaging, so installed apps receive the same CPU fix as development
apps.

The `postBuild` hook trims the unused V8 pack, configures the Windows launcher,
and bundles checksum-verified ICU compatibility data before signing and
compression. Bundling the data allows offline first launch on older system ICU
versions. HTTP/TLS packs remain available for version checks. The `postWrap` hook
sets the macOS installer's minimum OS requirement to match the runtime. Do not
modify a signed app after packaging.

The Mac download is a conventional drag-to-Applications DMG containing the actual
app. The pinned framework's self-extractor drops extended-attribute signatures
from generic runtime files. `prepare-release.mjs` extracts the framework's signed
inner app, restores those signatures and its resource seal, notarizes and staples
the resulting app, then creates, signs, notarizes and staples the final APFS DMG.
Use only the final files in `artifacts/release/` for distribution. Recheck this
workaround when upgrading the framework.

`artifacts/release/` contains versioned installer names and platform checksum
files. Upload the installers, a combined `SHA256SUMS.txt`, the third-party source
materials, and the third-party notice to the release. Never upload local QA logs,
credentials, unreviewed screenshots, or development build directories.

## Validate before publishing

- Run `bun run validate` on both native platforms.
- Install from the actual DMG and Windows setup ZIP. Verify launch, Open, Save As,
  undo/redo, comments, external-write conflicts, and update-menu behavior.
- On both platforms, confirm Sideleaf is offered for `.md` files, make it the
  default through the OS UI, and open a Unicode/spaced filename. Repeat while a
  dirty Sideleaf document is open and exercise Save, Cancel, and Discard.
- On macOS, verify all nested signatures, notarization staples, and Gatekeeper
  acceptance on the distribution and installed app. Check the app and installer
  minimum OS metadata against their binaries.
- On Windows, confirm the setup and launcher remain unsigned as intended, install
  and uninstall in an isolated test account or directory, and preserve user files.
  Confirm the launcher reports `Sideleaf` as its file description so Windows uses
  that name in the Open With picker.
- Check the packaged app's network behavior: release checks send no document
  content, authorization header, or installation identifier. Offline checks must
  leave the editor usable.
  Consume and validate the real GitHub response body in the packaged runtime,
  then verify the native menu's current-version result. The pinned runtime needs
  `Accept-Encoding: identity` to avoid a gzip decompression error.
- Review the public source, Git history, issue content, license notices, and
  installer contents. Publish only the tested source revision.

## Tag and announce

Keep `package.json` and `src/shared/version.ts` in agreement.
Create the `vX.Y.Z` tag at the verified source commit. Attach both platform
installers to the GitHub release and verify anonymous download access and their
SHA-256 checksums before linking them from the website.

The application checks the latest stable GitHub release at most once per day.
Tags must be `vMAJOR.MINOR.PATCH`; drafts and prereleases do not trigger notices.
The notice opens that release's page. Dismissing it hides that version, and
Help → Check for Updates can reveal it again. There is no automatic install or
forced restart. Publishing a later stable release is sufficient to notify users.

## Identity and upgrades

The canonical identifier is `ai.kortexa.sideleaf`. Verify both the outer and inner
macOS Info.plist and Windows `Resources/version.json` after packaging. The old
identifier was `xyz.sideleaf.desktop`; preserve its data directory. First launch
copies `updates.json` into the corresponding new identifier/channel directory only
when the new preference file is absent. Existing preferences win. Old diagnostic
logs remain at their old location; new logs use the canonical identifier. Documents
live independently of the application identifier and require no path migration.

On macOS, replace the installed Sideleaf.app in its existing Applications location;
Launch Services then reads the new bundle identity and Markdown document types. On Windows the identifier changes
the installer-managed directory and uninstall registry key. Install the new build,
launch it once to migrate preferences and update the Sideleaf shortcuts, then remove
the previous installation using its own uninstaller. Do not run the old uninstaller
before the new app has migrated preferences. The native adapter only updates shortcuts
whose targets belong to its own installation. The installer registers Sideleaf's
per-user Markdown capabilities without changing the user's selected defaults.

The Windows window and installed shortcuts use the same explicit AppUserModelID.
Relaunch command/name/icon properties point at the Sideleaf launcher, preserving the
JSC stack-limit adapter. Old pins made from Cottontail or the previous identifier
must be unpinned once; launch the new Sideleaf and pin that entry. Windows manages
user pins; the application does not silently rewrite the taskbar's private state.
See Microsoft's [relaunch property contract](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchcommand).

The CLI ships inside the app and runs with its bundled Cottontail. There is no npm
package to distribute. Run `bun run test:packaged-cli /path/to/bundled/sideleaf`
(`sideleaf.exe` on Windows) after packaging. This exercises pipes, input files,
comments, Unicode and conflict exits with Node/Bun absent from PATH. Test menu
installation on macOS and Windows, plus default-distro detection and installation
on Windows with and without WSL. See [command setup](cli.md).

The Windows release uses Inno Setup **6.7.3** for its CLI checkbox, per-user PATH,
shortcuts and uninstall lifecycle. This is a build-only tool. Install the official
[compiler](https://github.com/jrsoftware/issrc/releases/tag/is-6_7_3), verify its
Authenticode publisher is `Pyrsys B.V.`, and set `SIDELEAF_ISCC` to `ISCC.exe`.
The installer download's SHA-256 is
`9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732`.
The repository-local fallback path is `tmp/toolchain/inno/ISCC.exe`.
Setup installs to the same canonical app directory and retires the previous
Electrobun uninstall registration only when it owns that exact directory.
It does not touch preferences, document files, or WSL. Test both selected and
unselected CLI installation, upgrades, and uninstall in an isolated directory.
