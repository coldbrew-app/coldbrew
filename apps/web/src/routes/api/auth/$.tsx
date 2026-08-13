import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/start-client-core";

import { auth } from "@web/server/lib/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => auth.handler(request),
      POST: ({ request }: { request: Request }) => auth.handler(request),
    },
  },
});
