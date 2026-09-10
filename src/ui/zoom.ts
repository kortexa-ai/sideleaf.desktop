export const DEFAULT_ZOOM = 100;
export const MIN_ZOOM = 70;
export const MAX_ZOOM = 180;
export const ZOOM_STEP = 10;

export function normalizeZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stepped));
}

export function changeZoom(current: number, direction: -1 | 1): number {
  return normalizeZoom(current + direction * ZOOM_STEP);
}

export function storedZoom(value: string | null): number {
  return normalizeZoom(value === null || value.trim() === "" ? DEFAULT_ZOOM : Number(value));
}

export function zoomActionForCode(code: string): "in" | "out" | "reset" | null {
  if (code === "Digit0" || code === "Numpad0") return "reset";
  if (code === "Minus" || code === "NumpadSubtract") return "out";
  if (code === "Equal" || code === "NumpadAdd") return "in";
  return null;
}
