import { dlopen, FFIType, type Library } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ChannelLibrary = Library<{
  sideleaf_secure_directory: { args: [FFIType.ptr]; returns: FFIType.i32 };
  sideleaf_verify_path: { args: [FFIType.ptr, FFIType.i32, FFIType.i32]; returns: FFIType.i32 };
  sideleaf_process_state: { args: [FFIType.u32, FFIType.u64]; returns: FFIType.i32 };
  sideleaf_current_process_start_ms: { args: []; returns: FFIType.u64 };
  sideleaf_file_key: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32]; returns: FFIType.i32 };
}>;

let loaded: ChannelLibrary | null = null;

function nativeArtifact(name: string): string {
  const packaged = resolve(dirname(process.execPath), `../Resources/app/native/${name}`);
  if (existsSync(packaged)) return packaged;
  const source = resolve(`dist/native/${name}`);
  if (existsSync(source)) return source;
  throw new Error("Sideleaf's Windows channel identity adapter is missing. Rebuild or reinstall Sideleaf.");
}

function library(): ChannelLibrary {
  loaded ??= dlopen(nativeArtifact("sideleaf-channel.dll"), {
    sideleaf_secure_directory: { args: [FFIType.ptr], returns: FFIType.i32 },
    sideleaf_verify_path: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    sideleaf_process_state: { args: [FFIType.u32, FFIType.u64], returns: FFIType.i32 },
    sideleaf_current_process_start_ms: { args: [], returns: FFIType.u64 },
    sideleaf_file_key: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  });
  return loaded;
}

const wide = (value: string) => Buffer.from(`${value}\0`, "utf16le");

export function windowsChannelExecutable(): string {
  return nativeArtifact("sideleaf-channel.exe");
}

export function secureWindowsChannelDirectory(path: string): void {
  const result = library().symbols.sideleaf_secure_directory(wide(path));
  if (result !== 0) throw new Error(`Could not establish a private Windows Sideleaf channel directory (adapter status ${result}).`);
}

export function verifyWindowsChannelPath(path: string, directory: boolean, protectedAcl: boolean): void {
  const result = library().symbols.sideleaf_verify_path(wide(path), directory ? 1 : 0, protectedAcl ? 1 : 0);
  if (result !== 0) throw new Error(`The Windows Sideleaf channel path is not private to this user (adapter status ${result}).`);
}

export function windowsEndpointProcessState(pid: number, startedAtMs: number): "live" | "dead" | "unknown" {
  const result = library().symbols.sideleaf_process_state(pid, BigInt(startedAtMs));
  if (result === 0) return "live";
  if (result === 10 || result === 11) return "dead";
  return "unknown";
}

export function windowsCurrentProcessStartMs(): number {
  const value = library().symbols.sideleaf_current_process_start_ms();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Could not read Sideleaf's Windows process creation time.");
  return result;
}

export function windowsFileKey(path: string): string | null {
  const output = Buffer.alloc(160);
  const result = library().symbols.sideleaf_file_key(wide(path), output, output.byteLength);
  if (result === 0) return null;
  if (result < 0 || result > output.byteLength) throw new Error("Could not read the Windows file change identity.");
  return output.subarray(0, result).toString("ascii");
}
