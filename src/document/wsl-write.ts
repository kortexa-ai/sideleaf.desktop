import { execFileSync } from "node:child_process";
import { join, posix } from "node:path";

// All paths are positional arguments, never interpolated shell source. Keep one
// descriptor from exclusive creation through the write, so staging is private
// before any document bytes arrive. Both syncs must succeed before reporting a
// durable save; failure after rename still means the caller must reconcile.
export const WSL_WRITE_SCRIPT = `set -eu
umask 077
set -C
target=$1
temp=$2
mode=$3
length=$4
directory=$5
exec 3> "$temp"
trap 'rm -f -- "\${temp:?}"' EXIT
trap 'exit 1' HUP INT TERM
cat >&3
exec 3>&-
test "$(wc -c < "$temp")" -eq "$length"
chmod -- "$mode" "$temp"
sync -f -- "$temp"
mv -fT -- "$temp" "$target"
sync -f -- "$directory"
`;

export function writeWSLFile(location: { distro: string; path: string }, temporaryPath: string, bytes: Uint8Array, mode: number): void {
  execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32/wsl.exe"),
    ["--distribution", location.distro, "--exec", "/bin/sh", "-c", WSL_WRITE_SCRIPT, "sideleaf-write",
      location.path, temporaryPath, mode.toString(8), String(bytes.byteLength), posix.dirname(location.path)],
    { input: bytes, windowsHide: true, timeout: 20_000, stdio: ["pipe", "pipe", "pipe"] });
}
