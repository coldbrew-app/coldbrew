import { createFileRoute } from "@tanstack/react-router";
import { handleDonationAlertsAuthorize } from "@web/server/api/integration";

export const Route = createFileRoute("/api/integration/donationalerts/authorize")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleDonationAlertsAuthorize(request),
    },
  },
});
