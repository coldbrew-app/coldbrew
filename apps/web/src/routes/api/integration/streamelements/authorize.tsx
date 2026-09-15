import { createFileRoute } from "@tanstack/react-router";
import { handleStreamElementsAuthorize } from "@web/server/api/integration";

export const Route = createFileRoute("/api/integration/streamelements/authorize")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleStreamElementsAuthorize(request),
    },
  },
});
