import assert from "node:assert/strict";
import events from "electrobun/main/events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import config from "../electrobun.config.ts";
import { MARKDOWN_EXTENSIONS, isMarkdownPath, launchRequestFromFileActivation, launchRequestFromLaunch, pathFromLaunch, setFileActivationReceiver, takeInitialFileActivation, type LaunchRequest } from "../src/platform/file-open.ts";

test("macOS advertises Markdown, plain-text documents and alternate folder handling", () => {
  assert.deepEqual(config.app.fileAssociations, [{
    ext: [...MARKDOWN_EXTENSIONS],
    name: "Markdown document",
    role: "Editor",
  }, { ext: ["txt"], name: "Text document", role: "Editor" }]);
  const postBuild = readFileSync(new URL("../scripts/post-build.ts", import.meta.url), "utf8");
  assert.match(postBuild, /"UTExportedTypeDeclarations", "UTImportedTypeDeclarations"/);
  assert.match(postBuild, /LSItemContentTypes:0 string net\.daringfireball\.markdown/);
  assert.match(postBuild, /CFBundleDocumentTypes:1:LSItemContentTypes:0 string public\.plain-text/);
  assert.match(postBuild, /CFBundleDocumentTypes:2:LSItemContentTypes:0 string public\.folder/);
  assert.match(postBuild, /CFBundleDocumentTypes:2:CFBundleTypeRole string Viewer/);
  assert.match(postBuild, /CFBundleDocumentTypes:2:LSHandlerRank string Alternate/);
  assert.match(postBuild, /UTImportedTypeDeclarations:0:UTTypeConformsTo:0 string public\.plain-text/);
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /^import \{ launchRequestFromLaunch, resolveRelativeLink, setFileActivationReceiver, takeInitialFileActivation \} from "\.\/platform\/file-open\.ts";/);
});

test("file activation accepts local Markdown and text URLs and preserves their path", () => {
  const path = process.platform === "win32" ? "C:\\Notes\\leaf café.md" : "/Users/writer/leaf café.md";
  assert.deepEqual(launchRequestFromFileActivation(pathToFileURL(path).href), { kind: "open", path });
  assert.equal(launchRequestFromFileActivation("https://sideleaf.xyz/notes.md"), null);
  assert.deepEqual(launchRequestFromFileActivation(pathToFileURL(`${path}.TXT`).href), { kind: "open", path: `${path}.TXT` });
  assert.equal(launchRequestFromFileActivation(pathToFileURL(`${path}.pdf`).href), null);
  assert.equal(isMarkdownPath("DRAFT.MARKDOWN"), true);
});

test("folder activation detects actual directories before document suffixes", () => {
  const root = mkdtempSync(join(tmpdir(), "sideleaf-folder-activation-"));
  try {
    for (const name of ["leaf café 文", "folder.md", "folder.txt", "folder.pdf"]) {
      const path = join(root, name); mkdirSync(path);
      assert.deepEqual(launchRequestFromFileActivation(pathToFileURL(path).href), { kind: "open-folder", path });
      assert.deepEqual(launchRequestFromFileActivation(`${pathToFileURL(path).href}/`), { kind: "open-folder", path: `${path}${sep}` });
    }
    const unsupported = join(root, "document.pdf"); writeFileSync(unsupported, "plain text");
    assert.equal(launchRequestFromFileActivation(pathToFileURL(unsupported).href), null);
    assert.equal(launchRequestFromFileActivation(pathToFileURL(join(root, "missing folder")).href), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native activation rejects malformed URLs and encoded path separators", () => {
  for (const value of [undefined, 42, "not a URL", "file:///tmp/bad%ZZ.md", "file:///tmp/a%2Fb.md", "file:///tmp/a%5Cb.md"]) {
    assert.equal(launchRequestFromFileActivation(value), null);
  }
  if (process.platform !== "win32") assert.equal(launchRequestFromFileActivation("file://remote/notes.md"), null);
});

test("native events retain file and folder kinds through cold-launch buffering and running-app delivery", () => {
  const root = mkdtempSync(join(tmpdir(), "sideleaf-activation-queue-"));
  const path = join(root, "folder café.md"); mkdirSync(path);
  const file = join(root, "note.md"); writeFileSync(file, "# Note");
  const folderRequest: LaunchRequest = { kind: "open-folder", path };
  const fileRequest: LaunchRequest = { kind: "open", path: file };
  const activate = (target: string) => events.emitEvent(events.events.app.openUrl({ url: pathToFileURL(target).href }));
  try {
    assert.equal(takeInitialFileActivation(), null);
    activate(path); activate(file); activate(path);
    assert.deepEqual(takeInitialFileActivation(), folderRequest);
    const received: LaunchRequest[] = [];
    setFileActivationReceiver((request) => received.push(request));
    assert.deepEqual(received, [fileRequest, folderRequest]);
    assert.equal(takeInitialFileActivation(), null);
    activate(path); activate(file);
    assert.deepEqual(received, [fileRequest, folderRequest, folderRequest, fileRequest]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("explicit launch paths retain argument boundaries and prefer the native launcher environment", () => {
  assert.equal(pathFromLaunch(["sideleaf", "--sideleaf-open", "/tmp/a leaf.md"]), "/tmp/a leaf.md");
  assert.equal(pathFromLaunch(["sideleaf", "--sideleaf-open"], "C:\\Notes\\leaf.md"), "C:\\Notes\\leaf.md");
  assert.deepEqual(launchRequestFromLaunch(["sideleaf", "--sideleaf-open-folder", "/tmp/leaf folder"]), { kind: "open-folder", path: "/tmp/leaf folder" });
  assert.deepEqual(launchRequestFromLaunch(["sideleaf"], "C:\\Notes", "folder"), { kind: "open-folder", path: "C:\\Notes" });
  assert.equal(pathFromLaunch(["sideleaf"]), null);
});

test("Windows installer registers Sideleaf as a per-user Markdown editor", () => {
  const installer = readFileSync(new URL("../scripts/windows-installer.iss", import.meta.url), "utf8");
  assert.match(installer, /Software\\RegisteredApplications.*ValueName: "Sideleaf"/);
  assert.match(installer, /ChangesAssociations=yes/);
  assert.match(installer, /Software\\Classes\\Applications\\launcher\.exe.*ValueName: "FriendlyAppName".*ValueData: "Sideleaf"/);
  assert.match(installer, /Capabilities\\FileAssociations.*ValueName: "\.md".*Sideleaf\.Markdown/);
  assert.match(installer, /Capabilities\\FileAssociations.*ValueName: "\.txt".*Sideleaf\.Text/);
  assert.match(installer, /Software\\Classes\\\.txt\\OpenWithProgids.*ValueName: "Sideleaf\.Text"/);
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
