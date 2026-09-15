import { createFileRoute } from "@tanstack/react-router";
import { handleStreamElementsCallback } from "@web/server/api/integration";

export const Route = createFileRoute("/api/integration/streamelements/callback")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleStreamElementsCallback(request),
    },
  },
});
