import { createSql } from "@coldbrew/packages/pg.js";

import { env } from "../../env.js";
import { Store } from "./store.js";

export const sql = createSql(env.DATABASE_URL);
export const store = new Store(sql);
