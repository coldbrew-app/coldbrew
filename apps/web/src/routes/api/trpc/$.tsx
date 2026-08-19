import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@web/server/api/trpc";
import { createContext } from "@web/server/api/trpc/_config";

const handler = ({ request }: { request: Request }) =>
  fetchRequestHandler({
    createContext,
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
  });

export const Route = createFileRoute("/api/trpc/$")({
  server: { handlers: { GET: handler, POST: handler } },
});
