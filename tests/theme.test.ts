import { describe, expect, test } from "bun:test";
import { resolveTheme, storedPalette, storedTheme, THEME_PREFERENCES } from "../src/ui/theme.ts";

describe("appearance preference", () => {
  test("keeps Sideleaf colors by default and remembers the independent monochrome palette", () => {
    expect(storedPalette(null)).toBe("sideleaf");
    expect(storedPalette("unknown")).toBe("sideleaf");
    expect(storedPalette("monochrome")).toBe("monochrome");
    expect(storedPalette("sideleaf")).toBe("sideleaf");
  });
  test("accepts only the three supported persisted values", () => {
    expect(THEME_PREFERENCES).toEqual(["light", "dark", "system"]);
    expect(storedTheme("light")).toBe("light");
    expect(storedTheme("dark")).toBe("dark");
    expect(storedTheme("system")).toBe("system");
    expect(storedTheme(null)).toBe("system");
    expect(storedTheme("sepia")).toBe("system");
  });

  test("resolves System live while explicit choices ignore OS changes", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
