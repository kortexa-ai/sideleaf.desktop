import { accessSync, constants, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";

export function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
export function appleScriptString(value: string): string { return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; }

function run(executable: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", finished = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error("Command installation timed out. Please try again.")); }, timeout);
    function finish(error?: Error) { if (finished) return; finished = true; clearTimeout(timer); if (error) reject(error); else accept(stdout); }
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(stderr.trim().slice(0, 800) || `Installation failed (${code}).`)));
  });
}
const powershell = () => join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const wslExecutable = () => join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");
const resources = () => resolve(dirname(process.execPath), process.platform === "darwin" ? "../Resources/app/cli" : "../Resources/app/cli");
const commandPath = () => join(dirname(process.execPath), process.platform === "darwin" ? "sideleaf" : "sideleaf.exe");

export async function defaultWSLDistro(): Promise<string | null> {
  if (process.platform !== "win32" || !existsSync(wslExecutable())) return null;
  try {
    // Registry inspection does not start a distro or prompt to install WSL.
    const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'; $id=(Get-ItemProperty -LiteralPath $key).DefaultDistribution; if ($id) { $d=Get-ItemProperty -LiteralPath (Join-Path $key $id); if ($d.DistributionName -and $d.BasePath -and (Test-Path -LiteralPath $d.BasePath)) { [Console]::Write($d.DistributionName) } }`;
    const name = (await run(powershell(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], 10_000)).trim();
    return name && name.length <= 200 && !/[\r\n\0]/.test(name) ? name : null;
  } catch { return null; }
}

export async function installCommandLineTool(): Promise<string> {
  const command = commandPath();
  if (!existsSync(command)) throw new Error("The bundled command is missing. Reinstall Sideleaf.");
  if (process.platform === "darwin") {
    // Authorization belongs to the OS dialog. The script refuses unrelated files.
    const script = `/bin/sh ${shellQuote(join(resources(), "install-cli.sh"))} ${shellQuote(command)}`;
    let writable = false;
    try { accessSync("/usr/local/bin", constants.W_OK); writable = true; } catch { /* Ask macOS for authorization only when needed. */ }
    if (writable) await run("/bin/sh", [join(resources(), "install-cli.sh"), command]);
    else await run("/usr/bin/osascript", ["-e", `do shell script ${appleScriptString(script)} with administrator privileges`]);
    return "Installed sideleaf in /usr/local/bin. Run sideleaf --help in Terminal.";
  }
  if (process.platform === "win32") {
    await run(powershell(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(resources(), "install-cli.ps1"), "-AppBin", dirname(command)]);
    return "Installed sideleaf for your Windows account. Open a new terminal and run sideleaf --help.";
  }
  throw new Error("Use the Sideleaf desktop app on macOS or Windows to install the command.");
}

export async function installWSLCommand(expectedDistro: string): Promise<string> {
  const distro = await defaultWSLDistro();
  if (!distro || distro !== expectedDistro) throw new Error("The default WSL distribution changed or is unavailable. Reopen the menu and try again.");
  const wsl = wslExecutable();
  const nativeScript = join(resources(), "install-cli-wsl.sh");
  const scriptPath = (await run(wsl, ["--distribution", distro, "--exec", "wslpath", "-u", nativeScript])).trim();
  // Only the explicitly selected default distro is changed. Windows install never calls this.
  await run(wsl, ["--distribution", distro, "--user", "root", "--exec", "/bin/bash", scriptPath, commandPath()]);
  return `Installed sideleaf in ${distro}. Run sideleaf --help in a new WSL terminal.`;
}
