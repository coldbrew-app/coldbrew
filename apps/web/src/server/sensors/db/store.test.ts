import { AuthUserIdSchema, SlugSchema } from "@coldbrew/packages/schemas.js";
import { describe, expect, it, vi } from "vitest";

import { Store } from "./store.js";

describe("Store.getOrCreateUserId", () => {
  it("propagates an unexpected database error without retrying", async () => {
    const databaseError = new Error("database unavailable");
    const query = vi.fn(async () => []);
    const begin = vi.fn(async () => await Promise.reject(databaseError));
    const store = new Store(Object.assign(query, { begin }) as never);

    await expect(
      store.getOrCreateUserId(AuthUserIdSchema.parse("auth-user-id"), SlugSchema.parse("streamer")),
    ).rejects.toBe(databaseError);
    expect(begin).toHaveBeenCalledOnce();
  });
});
