import { env } from "../env.js";
import { sql } from "../sensors/db/index.js";
import { CredentialCipher } from "./credential-cipher.js";
import { RestreamStore } from "./store.js";

export const restreamStore = new RestreamStore(
  sql,
  new CredentialCipher(env.RESTREAM_CREDENTIALS_SECRET),
  env.RESTREAM_INGEST_URL,
);
