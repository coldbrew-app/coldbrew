import { createFileRoute } from "@tanstack/react-router";
import { env } from "@web/server/env";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          `User-agent: *\nAllow: /\nSitemap: ${new URL("/sitemap.xml", env.APP_DOMAIN).href}\n`,
          { headers: { "Content-Type": "text/plain; charset=utf-8" } },
        ),
    },
  },
});
