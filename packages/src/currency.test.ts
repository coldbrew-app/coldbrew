import { describe, expect, it } from "vitest";

import {
  conversionFactorForCurrencyChange,
  convertWithDefaultRate,
  defaultCurrencyChangeRate,
} from "./currency.js";
import { MoneySchema } from "./schemas.js";

describe("convertWithDefaultRate", () => {
  it("converts RUB, USD and EUR without floating point arithmetic", () => {
    expect(
      convertWithDefaultRate(MoneySchema.parse({ amount: "90.00", currency: "RUB" }), "USD"),
    ).toEqual({
      money: { amount: "1.00", currency: "USD" },
      rate: "1/90",
    });
    expect(
      convertWithDefaultRate(MoneySchema.parse({ amount: "1.00", currency: "EUR" }), "USD"),
    ).toEqual({
      money: { amount: "1.11", currency: "USD" },
      rate: "100/90",
    });
  });

  it("leaves unsupported source currencies unconverted", () => {
    expect(
      convertWithDefaultRate(MoneySchema.parse({ amount: "1.00", currency: "AUD" }), "RUB"),
    ).toBeNull();
  });

  it("uses the manually entered larger-to-smaller rate in either direction", () => {
    expect(
      conversionFactorForCurrencyChange(
        "RUB",
        "USD",
        MoneySchema.parse({ amount: "90", currency: "RUB" }).amount,
      ),
    ).toEqual({ numerator: 100n, denominator: 9000n });
    expect(
      conversionFactorForCurrencyChange(
        "USD",
        "RUB",
        MoneySchema.parse({ amount: "90", currency: "RUB" }).amount,
      ),
    ).toEqual({ numerator: 9000n, denominator: 100n });
  });

  it("rounds the configured default rate for a currency change", () => {
    expect(defaultCurrencyChangeRate("RUB", "USD")).toBe("90.00");
    expect(defaultCurrencyChangeRate("USD", "EUR")).toBe("1.00");
  });
});
