import { rurl } from "@lebedevna/readonly-url";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@web/server/env";

function isAllowedRequest(method: string, pathname: string) {
  return (
    (method === "GET" && /^\/api\/chat\/oauth\/(youtube|twitch|kick)\/callback$/.test(pathname)) ||
    (method === "POST" && pathname === "/api/chat/webhooks/kick")
  );
}

async function handler({ request }: { request: Request }) {
  const publicUrl = rurl(request.url);
  if (!isAllowedRequest(request.method, publicUrl.pathname)) {
    return new Response("Not found", { status: 404 });
  }

  const upstreamUrl = rurl(env.CHAT_SERVICE_URL)
    .withPathname(publicUrl.pathname.slice("/api/chat".length))
    .withSearch(publicUrl.search);
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("host");
  headers.set("Authorization", `Bearer ${env.CHAT_SERVICE_SECRET}`);
  headers.set("X-Forwarded-Host", publicUrl.host);
  headers.set("X-Forwarded-Prefix", "/api/chat");
  headers.set("X-Forwarded-Proto", publicUrl.protocol.slice(0, -1));

  const response = await fetch(upstreamUrl.href, {
    method: request.method,
    headers,
    redirect: "manual",
    ...(request.method === "GET" ? {} : { body: await request.arrayBuffer() }),
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export const Route = createFileRoute("/api/chat/$")({
  server: { handlers: { GET: handler, POST: handler } },
});
