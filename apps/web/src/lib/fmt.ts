import type { Money } from "@coldbrew/packages/schemas.js";

import type { Locale } from "./i18n";

const localeTag: Record<Locale, string> = { en: "en-US", ru: "ru-RU" };

export function fmtDate(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(localeTag[locale], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function fmtAmount(money: Money | number, locale: Locale) {
  const amount = typeof money === "number" ? money : Number(money.amount);
  const fractionDigits = amount < 10 ? 2 : 0;

  if (typeof money === "number") {
    return `${new Intl.NumberFormat(localeTag[locale], {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    }).format(money)} ₽`;
  }
  return new Intl.NumberFormat(localeTag[locale], {
    currency: money.currency,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(amount);
}

export function formatRelativeDate(date: Date, locale: Locale) {
  const { round, abs } = Math;
  const minutes = round((date.getTime() - Date.now()) / 60_000);
  const relativeTime = new Intl.RelativeTimeFormat(localeTag[locale], { numeric: "auto" });

  if (abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  if (abs(minutes) < 24 * 60) return relativeTime.format(round(minutes / 60), "hour");
  return relativeTime.format(round(minutes / (24 * 60)), "day");
}
