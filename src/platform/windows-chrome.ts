import type { BrowserWindow } from "electrobun/main/browser-window";

export type WindowsChrome = (action: "move" | "system-menu") => void;

// Electrobun hiddenInset retains the resize frame, but omits the system
// menu/minimize/maximize styles and moves windows with raw mouse deltas. Use
// Windows' caption loop so snap and drag-to-restore keep working normally.
// BrowserWindow supplies the HWND; the webview never chooses a native target.
export async function loadWindowsChrome() {
  if (process.platform !== "win32") return undefined;
  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const { symbols } = dlopen("user32.dll", {
    GetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i64 },
    SetWindowLongPtrW: { args: [FFIType.ptr, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
    SetWindowPos: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i32 },
    ReleaseCapture: { args: [], returns: FFIType.i32 },
    SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
    GetCursorPos: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetAsyncKeyState: { args: [FFIType.i32], returns: FFIType.i16 },
  });
  return (win: BrowserWindow): WindowsChrome => {
    const hwnd = win.ptr;
    if (!hwnd) throw new Error("Sideleaf window has no native handle");
    const style = Number(symbols.GetWindowLongPtrW(hwnd, -16));
    const shellStyles = 0x00080000 | 0x00020000 | 0x00010000;
    symbols.SetWindowLongPtrW(hwnd, -16, style | shellStyles);
    if ((Number(symbols.GetWindowLongPtrW(hwnd, -16)) & shellStyles) !== shellStyles) {
      throw new Error("Could not enable native Windows window actions");
    }
    // Refresh cached non-client geometry without moving, sizing, or activating.
    symbols.SetWindowPos(hwnd, null, 0, 0, 0, 0, 0x0020 | 0x0001 | 0x0002 | 0x0004 | 0x0010);
    return (action) => {
      if (action === "system-menu") {
        // SC_KEYMENU with Space opens the actual native system menu.
        if (!symbols.PostMessageW(hwnd, 0x0112, 0xf100, 0x20)) throw new Error("Could not open the window menu");
        return;
      }
      // The authenticated bridge request can arrive after a short click ends.
      if (!(symbols.GetAsyncKeyState(1) & 0x8000)) return;
      const point = new Int32Array(2);
      if (!symbols.GetCursorPos(ptr(point))) throw new Error("Could not read the cursor position");
      const position = (point[0]! & 0xffff) | ((point[1]! & 0xffff) << 16);
      symbols.ReleaseCapture();
      symbols.SendMessageW(hwnd, 0x00a1, 2, position);
    };
  };
}
