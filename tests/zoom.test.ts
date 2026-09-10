import { describe, expect, test } from "bun:test";
import { changeZoom, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, normalizeZoom, storedZoom, zoomActionForCode } from "../src/ui/zoom.ts";

describe("document zoom", () => {
  test("normalizes persisted values to the bounded ten-percent scale", () => {
    expect(storedZoom(null)).toBe(DEFAULT_ZOOM);
    expect(storedZoom(" ")).toBe(DEFAULT_ZOOM);
    expect(storedZoom("not a number")).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(104)).toBe(100);
    expect(normalizeZoom(106)).toBe(110);
    expect(normalizeZoom(5)).toBe(MIN_ZOOM);
    expect(normalizeZoom(500)).toBe(MAX_ZOOM);
  });

  test("keyboard steps stop cleanly at both limits", () => {
    expect(changeZoom(100, 1)).toBe(110);
    expect(changeZoom(100, -1)).toBe(90);
    expect(changeZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(changeZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  test("recognizes main-keyboard and keypad shortcuts by physical key", () => {
    expect(zoomActionForCode("Equal")).toBe("in");
    expect(zoomActionForCode("NumpadAdd")).toBe("in");
    expect(zoomActionForCode("Minus")).toBe("out");
    expect(zoomActionForCode("NumpadSubtract")).toBe("out");
    expect(zoomActionForCode("Digit0")).toBe("reset");
    expect(zoomActionForCode("Numpad0")).toBe("reset");
    expect(zoomActionForCode("KeyA")).toBeNull();
  });
});
