import { dirname, join } from "node:path";
import * as Utils from "electrobun/main/utils";
import { RESOURCES_FOLDER } from "electrobun/main/paths";

export async function chooseSavePath(document: { name: string; path: string | null }): Promise<string | null> {
  const folder = document.path ? dirname(document.path) : Utils.paths.documents;
  if (process.platform === "darwin") {
    const { dlopen, FFIType, CString } = await import("bun:ffi");
    const library = dlopen(join(RESOURCES_FOLDER, "app/native/libSideleafDialogs.dylib"), {
      sideleaf_save_dialog: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.ptr },
      sideleaf_free_string: { args: [FFIType.ptr], returns: FFIType.void },
    });
    const pointer = library.symbols.sideleaf_save_dialog(Buffer.from(`${document.name}\0`), Buffer.from(`${folder}\0`));
    if (!pointer) return null;
    try { return new CString(pointer).toString(); }
    finally { library.symbols.sideleaf_free_string(pointer); }
  }
  const windowsPicker = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.SaveFileDialog; $dialog.Title = 'Save Markdown'; $dialog.FileName = $env:SIDELEAF_DIALOG_NAME; $dialog.InitialDirectory = $env:SIDELEAF_DIALOG_FOLDER; $dialog.Filter = 'Markdown (*.md)|*.md|All files (*.*)|*.*'; $dialog.DefaultExt = 'md'; $dialog.AddExtension = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }; $dialog.Dispose()`;
  if (process.platform !== "win32") throw new Error("Native Save dialogs are currently supported on macOS and Windows.");
  const { spawn } = await import("node:child_process");
  const helper = "powershell.exe";
  const args = ["-NoProfile", "-STA", "-NonInteractive", "-Command", windowsPicker];
  return new Promise((resolve, reject) => {
    const child = spawn(helper, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, SIDELEAF_DIALOG_NAME: document.name, SIDELEAF_DIALOG_FOLDER: folder } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`The Save dialog failed (${code}). ${stderr.slice(0, 200)}`));
      else resolve(stdout.endsWith("\n") ? stdout.slice(0, -1) || null : stdout || null);
    });
  });
}
