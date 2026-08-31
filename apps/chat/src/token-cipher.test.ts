import { describe, expect, it } from "vitest";

import { TokenCipher } from "./token-cipher.js";

describe("chat token cipher", () => {
  it("round-trips a token without storing its plaintext", () => {
    const cipher = new TokenCipher("chat-secret");
    const encrypted = cipher.encrypt("provider-token");
    const $decrypted = cipher.decrypt(encrypted);

    expect(encrypted.toString()).not.toContain("provider-token");
    expect($decrypted.isOk() && $decrypted.value).toBe("provider-token");
  });

  it("rejects ciphertext encrypted with another secret", () => {
    const encrypted = new TokenCipher("first-secret").encrypt("provider-token");
    const $decrypted = new TokenCipher("second-secret").decrypt(encrypted);

    expect($decrypted.isErr() && $decrypted.error.type).toBe("token decryption failed");
  });
});
