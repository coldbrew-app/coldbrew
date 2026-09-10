import type { CurrencyCode, MoneyAmount } from "@coldbrew/packages/schemas.js";

import type { Locale } from "./i18n";

const localeTag: Record<Locale, string> = { en: "en-US", ru: "ru-RU" };

export function formatMoneyInputValue(amount: MoneyAmount) {
  return amount.replace(/\.00$/, "");
}

export function fmtDate(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(localeTag[locale], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function fmtListDate(date: Date, locale: Locale, now = new Date()) {
  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDifference = (dateDay - nowDay) / 86_400_000;
  const time = new Intl.DateTimeFormat(localeTag[locale], {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  if (dayDifference === 0) {
    return time;
  }
  if (dayDifference === -1) {
    const yesterday = new Intl.RelativeTimeFormat(localeTag[locale], {
      numeric: "auto",
    }).format(-1, "day");
    return `${yesterday}, ${time}`;
  }
  return fmtDate(date, locale);
}

export function fmtAmount(amount: MoneyAmount, currency: CurrencyCode, locale: Locale) {
  const numericAmount = Number(amount);
  const fractionDigits = amount.endsWith(".00") ? 0 : 2;

  return new Intl.NumberFormat(localeTag[locale], {
    currency,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(numericAmount);
}

export function fmtRubles(amount: number, locale: Locale) {
  const fractionDigits = amount < 10 ? 2 : 0;

  return `${new Intl.NumberFormat(localeTag[locale], {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(amount)} ₽`;
}
