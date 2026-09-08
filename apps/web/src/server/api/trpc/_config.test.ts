import { UserIdSchema } from "@coldbrew/packages/schemas.js";
import { describe, expect, it } from "vitest";

import { adminProcedure, router } from "./_config.js";

const testRouter = router({
  adminOnly: adminProcedure.query(() => "allowed"),
});

const userId = UserIdSchema.parse(42);
const user = { email: "admin@example.com", image: null, name: "Admin" };

describe("adminProcedure", () => {
  it("rejects an authenticated non-admin", async () => {
    const caller = testRouter.createCaller({
      request: new Request("http://localhost/trpc"),
      userId,
      viewer: { isAdmin: false, user, userId },
    });

    await expect(caller.adminOnly()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an administrator", async () => {
    const caller = testRouter.createCaller({
      request: new Request("http://localhost/trpc"),
      userId,
      viewer: { isAdmin: true, user, userId },
    });

    await expect(caller.adminOnly()).resolves.toBe("allowed");
  });
});
