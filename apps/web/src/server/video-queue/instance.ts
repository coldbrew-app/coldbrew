import { sql } from "../sensors/db/index.js";
import { getYoutubeTiming } from "../youtube.js";
import { createPostgresVideoQueue } from "./postgres.js";

export const videoQueue = createPostgresVideoQueue(sql, getYoutubeTiming);
