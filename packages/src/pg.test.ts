import { describe, expect, it } from "vitest";

import { parseJsonb } from "./pg.js";
import { MoneyAmountSchema } from "./schemas.js";

describe("parseJsonb", () => {
  it("keeps a large money amount exact", () => {
    const value = parseJsonb('{"amount":999999999999999999.99}') as { amount: unknown };

    expect(value.amount).toBe("999999999999999999.99");
    expect(MoneyAmountSchema.parse(value.amount)).toBe("999999999999999999.99");
  });
});
