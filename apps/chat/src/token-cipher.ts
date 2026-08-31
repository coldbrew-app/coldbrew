import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { erro } from "@lebedevna/neverthrow-utils";
import { ok, Result } from "neverthrow";

const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENVELOPE_VERSION = 1;

export type TokenDecryptionError = Readonly<{
  type: "token decryption failed";
  cause: unknown;
}>;

export class TokenCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(value: string) {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(value: Buffer): Result<string, TokenDecryptionError> {
    return Result.fromThrowable(
      () => {
        const version = value[0];
        if (version !== ENVELOPE_VERSION) throw new Error("Unsupported token envelope version");
        const nonceStart = 1;
        const tagStart = nonceStart + NONCE_LENGTH;
        const ciphertextStart = tagStart + AUTH_TAG_LENGTH;
        const decipher = createDecipheriv(
          "aes-256-gcm",
          this.key,
          value.subarray(nonceStart, tagStart),
        );
        decipher.setAuthTag(value.subarray(tagStart, ciphertextStart));
        return Buffer.concat([
          decipher.update(value.subarray(ciphertextStart)),
          decipher.final(),
        ]).toString("utf8");
      },
      (cause): TokenDecryptionError => ({ type: "token decryption failed", cause }),
    )().andThen((token) =>
      token.length > 0
        ? ok(token)
        : erro({ type: "token decryption failed", cause: new Error("Empty token") }),
    );
  }
}
