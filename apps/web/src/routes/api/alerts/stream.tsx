import { createFileRoute } from "@tanstack/react-router";
import { handleAlertStream } from "@web/server/donation-alert/http";

export const Route = createFileRoute("/api/alerts/stream")({
  server: { handlers: { POST: ({ request }) => handleAlertStream(request) } },
});
