import { createFileRoute } from "@tanstack/react-router";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@web/server/api/trpc";
import { createContext } from "@web/server/api/trpc/_config";
import { boundTrpcRequest } from "@web/server/api/trpc/request";

const handler = async ({ request }: { request: Request }) => {
  const boundedRequest = await boundTrpcRequest(request);
  if (boundedRequest instanceof Response) return boundedRequest;

  return fetchRequestHandler({
    createContext,
    endpoint: "/api/trpc",
    req: boundedRequest,
    router: appRouter,
  });
};

export const Route = createFileRoute("/api/trpc/$")({
  server: { handlers: { GET: handler, POST: handler } },
});
