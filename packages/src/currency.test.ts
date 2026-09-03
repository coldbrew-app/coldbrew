import { describe, expect, it } from "vitest";

import { conversionFactorForCurrencyChange, defaultCurrencyChangeRate } from "./currency.js";
import { MoneyAmountSchema } from "./schemas.js";

describe("queue currency changes", () => {
  it("uses the manually entered larger-to-smaller rate in either direction", () => {
    expect(conversionFactorForCurrencyChange("RUB", "USD", MoneyAmountSchema.parse("90"))).toEqual({
      numerator: 100n,
      denominator: 9000n,
    });
    expect(conversionFactorForCurrencyChange("USD", "RUB", MoneyAmountSchema.parse("90"))).toEqual({
      numerator: 9000n,
      denominator: 100n,
    });
  });

  it("rounds the configured default rate for a currency change", () => {
    expect(defaultCurrencyChangeRate("RUB", "USD")).toBe("90.00");
    expect(defaultCurrencyChangeRate("USD", "EUR")).toBe("1.00");
  });
});
