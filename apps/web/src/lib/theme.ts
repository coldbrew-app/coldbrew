export const themes = ["light", "dark"] as const;
export type Theme = (typeof themes)[number];

export const themeCookieName = "theme";

export function resolveTheme(storedTheme: string | null | undefined): Theme {
  return storedTheme === "dark" ? "dark" : "light";
}
