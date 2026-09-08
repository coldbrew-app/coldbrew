import { describe, expect, test, vi } from "vitest";

vi.mock("./env.js", () => ({ env: { ADMIN_EMAILS: "" } }));

import { parseAdminEmails } from "./admin";

describe("parseAdminEmails", () => {
  test("normalizes, removes duplicates, and ignores empty entries", () => {
    expect(parseAdminEmails(" Admin@Example.com,viewer@example.com, admin@example.com, ")).toEqual([
      "admin@example.com",
      "viewer@example.com",
    ]);
  });
});
