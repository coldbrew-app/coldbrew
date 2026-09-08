import { sql } from "../sensors/db/index.js";
import { createPostgresVideoQueue } from "./postgres.js";

export const videoQueue = createPostgresVideoQueue(sql);
