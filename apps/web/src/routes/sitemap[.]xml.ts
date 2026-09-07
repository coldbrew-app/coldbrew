import { createFileRoute } from "@tanstack/react-router";
import { env } from "@web/server/env";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const urls = ["/", "/docs/privacy", "/docs/tos"].map(
          (path) => `<url><loc>${new URL(path, env.APP_DOMAIN).href}</loc></url>`,
        );
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`,
          { headers: { "Content-Type": "application/xml; charset=utf-8" } },
        );
      },
    },
  },
});
