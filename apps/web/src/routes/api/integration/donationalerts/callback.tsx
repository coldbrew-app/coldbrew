import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/start-client-core";
import { handleDonationAlertsCallback } from "@web/server/api/integration";

export const Route = createFileRoute("/api/integration/donationalerts/callback")({
  server: {
    handlers: { GET: ({ request }: { request: Request }) => handleDonationAlertsCallback(request) },
  },
});
