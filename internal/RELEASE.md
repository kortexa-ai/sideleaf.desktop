# Kortexa internal release procedure

This is how the kortexa.ai team publishes a Sideleaf GitHub release. The general
requirements (build hooks, signing, what to check before publishing) are in
[docs/releasing.md](../docs/releasing.md). Machine setup and the Windows build
are in [TESTING.md](TESTING.md). Keep all credentials in the Keychain or ignored
local files. This document names profiles and variables, never their values.

## 1. Track and prepare

1. Create the release issue with the `kortexa-github` broker, add it to
   Project 4, and set it to In progress. Acquire a Factory claim for the files
   you change.
2. Change `package.json` `"version"` and `src/shared/version.ts` `APP_VERSION`
   together. Update `README.md` when its download link or feature text changes.
3. Commit `release: prepare Sideleaf X.Y.Z (#ISSUE)` on `main` and push it. This
   commit SHA is the release commit. **Commit before you build.** A build from
   an uncommitted tree must be built again.

## 2. Build macOS on Snappy

```sh
bun install --frozen-lockfile && bun run prepare:devkit && bun run build:notices
ELECTROBUN_DEVELOPER_ID='<Developer ID Application identity>' bun run build:release
```

- Get the identity name from `security find-identity -v -p codesigning`.
- `build:release` validates, builds the stable app, then runs
  `scripts/prepare-release.mjs`. That script signs, notarizes and staples the
  app, then creates, signs, notarizes and staples the APFS DMG. Notarization uses
  the Keychain profile named `notarytool`. No Apple ID variables are necessary.
- Verify the DMG: `hdiutil attach -readonly`, `codesign --verify --deep --strict`,
  `spctl --assess` (execute for the app, open for the DMG), and
  `xcrun stapler validate` for both.
- Output in `artifacts/release/`: `Sideleaf-X.Y.Z-macos-arm64.dmg`,
  `SHA256SUMS-macos.txt` and `Sideleaf-X.Y.Z-THIRD-PARTY-NOTICES.txt`.

## 3. Build Windows on Scrappy

- Synchronize `C:\src\sideleaf.desktop` to the release SHA with `pull --ff-only`.
- Run the TESTING.md PowerShell script through `-EncodedCommand`, with
  `bun run build:release` in place of `bun run build`. Inno Setup comes from
  `SIDELEAF_ISCC` or `tmp/toolchain/inno/ISCC.exe`.
- The artifact is `artifacts\release\Sideleaf-X.Y.Z-windows-x64-setup.zip`.
  Copy it to Snappy's `artifacts/release/` as base64 over SSH (see TESTING.md).
  Compare its SHA-256 on both machines. The NOTICES file must also have the
  same hash on both platforms.

## 4. Assemble the assets

Upload exactly these files:

| Asset | Content type | Source |
| --- | --- | --- |
| `Sideleaf-X.Y.Z-macos-arm64.dmg` | `application/x-apple-diskimage` | Step 2 |
| `Sideleaf-X.Y.Z-windows-x64-setup.zip` | `application/zip` | Step 3 |
| `Sideleaf-X.Y.Z-THIRD-PARTY-NOTICES.txt` | `text/plain` | `bun run build:notices` |
| `Sideleaf-X.Y.Z-runtime-sources.tar.gz` | `application/gzip` | By hand, see below |
| `SHA256SUMS.txt` | `text/plain` | By hand, see below |

- **Runtime sources:** when `bun.lock` and `scripts/third-party-sources.json`
  have not changed, reuse the previous release's archive byte for byte under the
  new name. Otherwise build a new one that contains the runtime patches, the JSC
  build and ICU archives, a Cottontail/Electrobun source archive at the pinned
  revisions, `BUILDING.md`, `THIRD-PARTY-NOTICES.txt` and an inner
  `SHA256SUMS.txt`. Then `tar -czf` it.
- **Checksums:** in `artifacts/release/`, run
  `shasum -a 256 <dmg> <zip> <runtime-sources> <notices> > SHA256SUMS.txt` and
  check the result with `shasum -c SHA256SUMS.txt`.
- **Do not upload WebKit source.** See the next section.

## 5. WebKit corresponding source

Cottontail embeds WebKit/JavaScriptCore. The WebKit license requires that users
can get the corresponding source. The source is published once, as the
`webkit-source-<short-sha>` pre-release. Each Sideleaf release links to it and
does not upload it again. The current source release is `webkit-source-27877cc2`.

The broker cannot edit a release body after creation. Put this footer at the
end of the `body` in `release-create`:

```markdown
---

<!-- sideleaf-webkit-source:27877cc2acd8a3cea8b3827ddb48d6c6c0177714 -->
Corresponding WebKit/JavaScriptCore source: [WebKit 27877cc2acd8a3cea8b3827ddb48d6c6c0177714](https://github.com/kortexa-ai/sideleaf.desktop/releases/download/webkit-source-27877cc2/WebKit-27877cc2acd8a3cea8b3827ddb48d6c6c0177714-source.tar.gz) (SHA-256: `d1fe3fbe5195aeecd39bd576b1ac68ed6e3a5b0e1f3b8c27399ab89210d379ca`).
```

When a Cottontail upgrade changes the WebKit revision, publish a new
`webkit-source-<short-sha>` pre-release and update this footer. The broker
cannot do that, so it needs Franci's explicit authorization for a personal `gh`
exception. The 27877cc2 release was done that way under issue #68.

## 6. Publish with the broker

Write a common specification, for example `release.json`:

```json
{"tag": "vX.Y.Z", "commit": "<40-char release SHA>", "name": "Sideleaf X.Y.Z",
 "body": "<notes + WebKit footer>", "prerelease": false, "draft": true}
```

1. Tag the release commit:
   `git tag -a vX.Y.Z <sha> -m 'Sideleaf X.Y.Z' && git push origin refs/tags/vX.Y.Z`.
2. `kortexa-github release-create kortexa-ai/sideleaf.desktop < release.json`.
3. Find the draft ID with `release-get`: the specification plus
   `"releaseId": null, "expectedAssets": []`.
4. Upload each asset with `release-asset-upload`. Stdin is one JSON header line,
   then LF, then the raw bytes. The header is the specification plus
   `releaseId`, `asset` (`name`, `size`, `digest: "sha256:<hex>"`,
   `contentType`) and `expectedAssets`, the complete inventory after this upload:

   ```sh
   (printf '%s\n' "$header"; cat "$file") | kortexa-github release-asset-upload kortexa-ai/sideleaf.desktop
   ```

5. `release-publish`: the specification plus `releaseId`, the full
   `expectedAssets` and `"makeLatest": true`.
6. Verify with `release-get`: `"draft": false`, `"expectLatest": true`, without
   `makeLatest`.

**Never retry a mutation with an unresolved result.** For example,
`release-create` can return `RELEASE_RESULT_UNRESOLVED_DO_NOT_RETRY_MUTATION`
after it did create the draft. Use `release-get` (step 3) to find it instead.

## 7. After publishing

- Anonymous check: `curl https://api.github.com/repos/kortexa-ai/sideleaf.desktop/releases/latest`
  must show the new tag. Download every asset without authentication and run
  `shasum -c SHA256SUMS.txt`. (`gh release view --json isLatest` fails; use
  `gh release list --json isLatest`.)
- Install from the real DMG and ZIP. macOS can refuse to replace
  `/Applications/Sideleaf.app` from the command line; use Finder.
- Add the evidence to the issues, close them, and set Project 4 to Done.

## 8. Update the website and deploy it to production

A release is not complete until sideleaf.xyz links to it. The website is the
`kortexa-ai/sideleaf` repository, checked out at `~/src/sideleaf` on Snappy.
Track it with an issue in that repository.

1. On Snappy, update the version, download links and changed features in
   `index.html`, `docs/index.html`, `privacy/index.html` and
   `public/sitemap.xml`. Link only to verified release assets.
2. Run `npm ci && npm run build`. Commit on `main` and push. Record the SHA.
3. On Smarty (production, `/home/francip/src/sideleaf`):
   - Require a clean checkout on `main`. Fetch, then fast-forward
     (`git merge --ff-only`) to the pushed SHA. Stop if it is dirty, ahead or
     divergent. Never reset.
   - Run `npm ci`, then build into a staging directory:
     `npm run build -- --outDir <stage>`.
   - Swap the stage in for `dist` and keep the previous `dist` as the rollback
     copy until the checks pass.
   - Nginx reads `dist` directly, so a content update does not need a reload.
     Reload only when `nginx/*.conf` changes: `sudo nginx -t && sudo systemctl reload nginx`.
4. Verify from outside: `curl -I https://sideleaf.xyz/`, the docs and privacy
   pages, and every download link on the page (each must return the new
   release asset). If a check fails, restore the previous `dist`.
5. Add the deployed SHA and the check results to the website issue and close it.
