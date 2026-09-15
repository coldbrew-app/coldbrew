import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSql, parseJsonb } from "./pg.js";
import { MoneyAmountSchema } from "./schemas.js";

describe("parseJsonb", () => {
  it("keeps a large money amount exact", () => {
    const value = z
      .object({ amount: z.unknown() })
      .parse(parseJsonb('{"amount":999999999999999999.99}'));

    expect(value.amount).toBe("999999999999999999.99");
    expect(MoneyAmountSchema.parse(value.amount)).toBe("999999999999999999.99");
  });
});

describe("createSql", () => {
  it("sets a dedicated PostgreSQL search path when requested", async () => {
    const sql = createSql("postgresql://localhost/streambrew", { searchPath: "auth" });

    expect(sql.options.connection["search_path"]).toBe("auth");

    await sql.end();
  });
});
