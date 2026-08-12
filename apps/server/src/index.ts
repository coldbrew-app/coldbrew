import { serve } from "@hono/node-server";
import { logger } from "@omnistream/packages/logger.js";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { apiRouter } from "./api/index.js";
import { env } from "./env.js";
import { auth } from "./lib/auth.js";

async function main() {
  const port = env.PORT;
  const app = new Hono();

  app.use("*", cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/api", apiRouter);

  serve({ fetch: app.fetch, port });
  logger.info(`Server listening on http://localhost:${port}`);
}

main();
