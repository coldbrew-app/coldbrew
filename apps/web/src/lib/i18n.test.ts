import { CurrencyCodeSchema, MoneyAmountSchema } from "@coldbrew/packages/schemas.js";
import { describe, expect, it } from "vitest";

import { fmtAmount, fmtDate, fmtListDate, fmtRubles, formatMoneyInputValue } from "./fmt";
import { resolveLocale } from "./i18n";

describe("resolveLocale", () => {
  it("uses a persisted supported locale", () => {
    expect(resolveLocale("en", "ru-RU")).toBe("en");
  });

  it("detects Russian browser locales", () => {
    expect(resolveLocale(null, "ru-RU")).toBe("ru");
  });

  it("falls back to English for other browser locales", () => {
    expect(resolveLocale(null, "de-DE")).toBe("en");
  });
});

describe("localized formatters", () => {
  it("formats amounts and dates with the selected locale", () => {
    const date = new Date("2026-08-12T13:45:00Z");

    expect(fmtRubles(12345.6, "en")).toBe("12,346 ₽");
    expect(fmtRubles(12345.6, "ru")).toBe("12 346 ₽");
    expect(fmtDate(date, "en")).not.toBe(fmtDate(date, "ru"));
  });

  it.each([
    [1, "1.00 ₽", "1,00 ₽"],
    [9.5, "9.50 ₽", "9,50 ₽"],
    [10, "10 ₽", "10 ₽"],
    [10.6, "11 ₽", "11 ₽"],
  ])("formats %d rubles with amount-dependent precision", (amount, en, ru) => {
    expect(fmtRubles(amount, "en")).toBe(en);
    expect(fmtRubles(amount, "ru")).toBe(ru);
  });

  it("omits zero cents and preserves non-zero cents for currency-aware money", () => {
    const usd = CurrencyCodeSchema.parse("USD");

    expect(fmtAmount(MoneyAmountSchema.parse("1.00"), usd, "en")).toBe("$1");
    expect(fmtAmount(MoneyAmountSchema.parse("9.50"), usd, "en")).toBe("$9.50");
    expect(fmtAmount(MoneyAmountSchema.parse("10.60"), usd, "en")).toBe("$10.60");
  });

  it.each([
    [new Date(2026, 8, 10, 13, 45), "en", "01:45 PM"],
    [new Date(2026, 8, 10, 13, 45), "ru", "13:45"],
    [new Date(2026, 8, 9, 13, 45), "en", "yesterday, 01:45 PM"],
    [new Date(2026, 8, 9, 13, 45), "ru", "вчера, 13:45"],
    [new Date(2026, 8, 8, 13, 45), "en", "Sep 8, 01:45 PM"],
    [new Date(2026, 8, 8, 13, 45), "ru", "8 сент., 13:45"],
  ] as const)("formats list date %s for %s", (date, locale, expected) => {
    expect(fmtListDate(date, locale, new Date(2026, 8, 10, 9))).toBe(expected);
  });

  it("uses calendar days instead of elapsed 24-hour periods", () => {
    expect(fmtListDate(new Date(2026, 2, 7, 23), "en", new Date(2026, 2, 8))).toBe(
      "yesterday, 11:00 PM",
    );
  });
});

describe("formatMoneyInputValue", () => {
  it.each([
    ["0.00", "0"],
    ["100.00", "100"],
    ["100.50", "100.50"],
    ["100.01", "100.01"],
  ])("formats %s as %s", (amount, expected) => {
    expect(formatMoneyInputValue(MoneyAmountSchema.parse(amount))).toBe(expected);
  });
});
