import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/start-client-core";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => new Response("ok"),
    },
  },
});
