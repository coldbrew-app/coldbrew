import { describe, expect, it } from "vitest";

import { CredentialCipher, CredentialDecryptionError } from "./credential-cipher.js";

describe("CredentialCipher", () => {
  it("round-trips credentials without retaining plaintext", () => {
    const cipher = new CredentialCipher("test-restream-credential-secret-32-characters");
    const encrypted = cipher.encrypt("destination-key");

    expect(encrypted.includes(Buffer.from("destination-key"))).toBe(false);
    expect(cipher.decrypt(encrypted)).toBe("destination-key");
  });

  it("rejects credentials encrypted with another secret", () => {
    const first = new CredentialCipher("first-restream-credential-secret-32-characters");
    const second = new CredentialCipher("second-restream-credential-secret-32-characters");

    expect(() => second.decrypt(first.encrypt("destination-key"))).toThrow(
      CredentialDecryptionError,
    );
  });

  it("decrypts the Go-compatible envelope layout", () => {
    const cipher = new CredentialCipher("chat-secret");
    const envelope = Buffer.from(
      "01000102030405060708090a0b9e11518db4acd421195fca5be9a301601ec2a3f5af0d39788eb02191a589",
      "hex",
    );

    expect(cipher.decrypt(envelope)).toBe("provider-token");
  });
});
