import type {
  CurrencyCode,
  DonationAmount,
  DonationAsset,
  MoneyAmount,
} from "@streambrew/packages/schemas.js";

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

export function fmtAmount(
  amount: MoneyAmount | DonationAmount,
  currency: CurrencyCode | DonationAsset,
  locale: Locale,
) {
  const [integer, fraction = "00"] = amount.split(".");
  const significantFraction = fraction.replace(/0+$/, "");
  const fractionDigits =
    fraction.length <= 2 && significantFraction.length > 0 ? 2 : significantFraction.length;
  const displayFraction = fractionDigits === 2 ? fraction.padEnd(2, "0") : significantFraction;
  const usesCurrencyStyle = /^[A-Z]{3}$/.test(currency);
  const formatter = new Intl.NumberFormat(localeTag[locale], {
    ...(usesCurrencyStyle ? { currency } : {}),
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: usesCurrencyStyle ? "currency" : "decimal",
  });

  const formatted = formatter
    .formatToParts(BigInt(integer))
    .map((part) => (part.type === "fraction" ? displayFraction : part.value))
    .join("");
  return usesCurrencyStyle ? formatted : `${formatted}\u00a0${currency}`;
}

export function fmtRubles(amount: number, locale: Locale) {
  const fractionDigits = amount < 10 ? 2 : 0;

  return `${new Intl.NumberFormat(localeTag[locale], {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(amount)} ₽`;
}
