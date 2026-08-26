import { createHash, randomBytes } from "node:crypto";

export function createOverlayToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOverlayToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
