import { createFileRoute } from "@tanstack/react-router";
import { handleStreamlabsCallback } from "@web/server/api/integration";

export const Route = createFileRoute("/api/integration/streamlabs/callback")({
  server: {
    handlers: { GET: ({ request }: { request: Request }) => handleStreamlabsCallback(request) },
  },
});
