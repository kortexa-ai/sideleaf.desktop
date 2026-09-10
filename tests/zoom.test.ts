import { describe, expect, test } from "bun:test";
import { changeZoom, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, normalizeZoom, storedZoom } from "../src/ui/zoom.ts";

describe("document zoom", () => {
  test("normalizes persisted values to the bounded ten-percent scale", () => {
    expect(storedZoom(null)).toBe(DEFAULT_ZOOM);
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
});
