import { createFileRoute } from "@tanstack/react-router";
import { handleAlertMedia } from "@web/server/donation-alert/http";

export const Route = createFileRoute("/api/alerts/media/$assetId")({
  server: {
    handlers: {
      GET: ({ request }) => handleAlertMedia(request),
      POST: ({ request }) => handleAlertMedia(request),
    },
  },
});
