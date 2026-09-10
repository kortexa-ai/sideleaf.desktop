export const THEME_STORAGE_KEY = "sideleaf.theme";
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = typeof THEME_PREFERENCES[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export function storedTheme(value: string | null): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? value as ThemePreference : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}
