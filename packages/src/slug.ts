import { randomUUID } from "node:crypto";

import { SlugSchema } from "./schemas.js";

export function slugFromEmail(email: string) {
  const slugWithoutPrefix =
    email
      .split("@", 1)
      .at(0)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 47) ?? "";

  if (slugWithoutPrefix.length === 0) {
    return SlugSchema.parse(randomUUID());
  }
  if (slugWithoutPrefix.length < 3) {
    return SlugSchema.parse(slugWithoutPrefix.padEnd(3, "0"));
  }
  return SlugSchema.parse(slugWithoutPrefix);
}
