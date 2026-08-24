import { MoneySchema } from "@coldbrew/packages/schemas.js";
import { describe, expect, it } from "vitest";

import { fmtAmount, fmtDate } from "./fmt";
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

    expect(fmtAmount(12345.6, "en")).toBe("12,346 ₽");
    expect(fmtAmount(12345.6, "ru")).toBe("12 346 ₽");
    expect(fmtDate(date, "en")).not.toBe(fmtDate(date, "ru"));
  });

  it.each([
    [1, "1.00 ₽", "1,00 ₽"],
    [9.5, "9.50 ₽", "9,50 ₽"],
    [10, "10 ₽", "10 ₽"],
    [10.6, "11 ₽", "11 ₽"],
  ])("formats %d rubles with amount-dependent precision", (amount, en, ru) => {
    expect(fmtAmount(amount, "en")).toBe(en);
    expect(fmtAmount(amount, "ru")).toBe(ru);
  });

  it("uses amount-dependent precision for currency-aware money", () => {
    expect(fmtAmount(MoneySchema.parse({ amount: "9.50", currency: "USD" }), "en")).toBe("$9.50");
    expect(fmtAmount(MoneySchema.parse({ amount: "10.60", currency: "USD" }), "en")).toBe("$11");
  });
});
