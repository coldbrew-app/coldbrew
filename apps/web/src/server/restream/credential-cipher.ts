import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class CredentialDecryptionError extends Error {
  constructor(options: ErrorOptions = {}) {
    super("Restream credential decryption failed.", options);
  }
}

export class CredentialCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(value: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(envelope: Uint8Array): string {
    try {
      if (envelope.length < 1 + NONCE_BYTES + TAG_BYTES || envelope[0] !== ENVELOPE_VERSION) {
        throw new Error("Invalid credential envelope.");
      }
      const value = Buffer.from(envelope);
      const nonce = value.subarray(1, 1 + NONCE_BYTES);
      const tag = value.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
      const ciphertext = value.subarray(1 + NONCE_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", this.key, nonce);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      );
      if (plaintext.length === 0) throw new Error("Empty credential.");
      return plaintext;
    } catch (error) {
      if (error instanceof CredentialDecryptionError) throw error;
      throw new CredentialDecryptionError({ cause: error });
    }
  }
}
