export const locales = ["en", "ru"] as const;
export type Locale = (typeof locales)[number];

export const localeCookieName = "locale";

export function resolveLocale(
  storedLocale: string | null | undefined,
  preferredLanguage: string | undefined,
): Locale {
  if (storedLocale === "ru" || storedLocale === "en") return storedLocale;
  return preferredLanguage?.toLowerCase().startsWith("ru") ? "ru" : "en";
}
