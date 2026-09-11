import { createFileRoute } from "@tanstack/react-router";
import { handleStreamlabsAuthorize } from "@web/server/api/integration";

export const Route = createFileRoute("/api/integration/streamlabs/authorize")({
  server: {
    handlers: { GET: ({ request }: { request: Request }) => handleStreamlabsAuthorize(request) },
  },
});
