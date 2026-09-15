import { createFileRoute } from "@tanstack/react-router";
import { handleRestreamMedia } from "@web/server/restream/http";

export const Route = createFileRoute("/api/restream/media")({
  server: { handlers: { POST: ({ request }) => handleRestreamMedia(request) } },
});
