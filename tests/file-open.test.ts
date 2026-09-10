import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import config from "../electrobun.config.ts";
import { MARKDOWN_EXTENSIONS, isMarkdownPath, pathFromFileActivation, pathFromLaunch } from "../src/platform/file-open.ts";

test("macOS advertises the Markdown formats Sideleaf can edit", () => {
  assert.deepEqual(config.app.fileAssociations, [{
    ext: [...MARKDOWN_EXTENSIONS],
    name: "Markdown document",
    role: "Editor",
  }]);
  const postBuild = readFileSync(new URL("../scripts/post-build.ts", import.meta.url), "utf8");
  assert.match(postBuild, /"UTExportedTypeDeclarations", "UTImportedTypeDeclarations"/);
  assert.match(postBuild, /LSItemContentTypes:0 string net\.daringfireball\.markdown/);
  assert.match(postBuild, /UTImportedTypeDeclarations:0:UTTypeConformsTo:0 string public\.plain-text/);
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /^import \{ pathFromLaunch, setFileActivationReceiver, takeInitialFileActivation \} from "\.\/platform\/file-open\.ts";/);
});

test("file activation accepts local Markdown URLs and preserves their path", () => {
  const path = process.platform === "win32" ? "C:\\Notes\\leaf café.md" : "/Users/writer/leaf café.md";
  assert.equal(pathFromFileActivation(pathToFileURL(path).href), path);
  assert.equal(pathFromFileActivation("https://sideleaf.xyz/notes.md"), null);
  assert.equal(pathFromFileActivation(pathToFileURL(`${path}.txt`).href), null);
  assert.equal(isMarkdownPath("DRAFT.MARKDOWN"), true);
});

test("explicit launch paths retain argument boundaries and prefer the native launcher environment", () => {
  assert.equal(pathFromLaunch(["sideleaf", "--sideleaf-open", "/tmp/a leaf.md"]), "/tmp/a leaf.md");
  assert.equal(pathFromLaunch(["sideleaf", "--sideleaf-open"], "C:\\Notes\\leaf.md"), "C:\\Notes\\leaf.md");
  assert.equal(pathFromLaunch(["sideleaf"]), null);
});

test("Windows installer registers Sideleaf as a per-user Markdown editor", () => {
  const installer = readFileSync(new URL("../scripts/windows-installer.iss", import.meta.url), "utf8");
  assert.match(installer, /Software\\RegisteredApplications.*ValueName: "Sideleaf"/);
  assert.match(installer, /ChangesAssociations=yes/);
  assert.match(installer, /Software\\Classes\\Applications\\launcher\.exe.*ValueName: "FriendlyAppName".*ValueData: "Sideleaf"/);
  assert.match(installer, /Capabilities\\FileAssociations.*ValueName: "\.md".*Sideleaf\.Markdown/);
  assert.match(installer, /Software\\Classes\\\.md\\OpenWithProgids.*ValueType: string.*ValueName: "Sideleaf\.Markdown".*ValueData: ""/);
  assert.match(installer, /launcher\.exe"" --sideleaf-open ""%1/);
  const launcher = readFileSync(new URL("../src/platform/windows-launcher.c", import.meta.url), "utf8");
  assert.match(launcher, /lstrcpynW\(workingDirectory, runtimePath, \(int\)directory \+ 1\).*CreateProcessW\([^;]+workingDirectory/s);
  const resource = readFileSync(new URL("../src/platform/windows-launcher.rc", import.meta.url), "utf8");
  assert.match(resource, /^1 VERSIONINFO$/m);
  assert.match(resource, /VALUE "FileDescription", "Sideleaf"/);
  assert.match(resource, /VALUE "ProductName", "Sideleaf"/);
  assert.match(resource, /FILEVERSION @SIDELEAF_VERSION_COMMAS@/);
  const configure = readFileSync(new URL("../scripts/configure-windows-runtime.mjs", import.meta.url), "utf8");
  assert.match(configure, /readFile\("package\.json", "utf8"\)/);
  assert.match(configure, /replaceAll\("@SIDELEAF_VERSION_COMMAS@", resourceVersion\)/);
  const installerBuild = readFileSync(new URL("../scripts/build-windows-installer.mjs", import.meta.url), "utf8");
  assert.match(installerBuild, /nativeLauncherHash !== launcherManifest\.wrapperHash/);
  assert.match(installerBuild, /copyFileSync\(nativeLauncher, resolve\(payload, "bin\/launcher\.exe"\)\)/);
});
