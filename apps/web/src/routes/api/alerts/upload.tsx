import { createFileRoute } from "@tanstack/react-router";
import { handleAlertUpload } from "@web/server/donation-alert/http";

export const Route = createFileRoute("/api/alerts/upload")({
  server: { handlers: { POST: ({ request }) => handleAlertUpload(request) } },
});
