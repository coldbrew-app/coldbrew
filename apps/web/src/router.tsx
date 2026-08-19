import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { parseCookie } from "cookie-es";

import { localeCookieName, resolveLocale } from "./lib/locale";
import { routeTree } from "./routeTree.gen";

function getInitialLocale() {
  if (typeof document === "undefined") return "en" as const;
  return resolveLocale(parseCookie(document.cookie)[localeCookieName], navigator.language);
}

export function getRouter() {
  const locale = getInitialLocale();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 0 } },
  });
  const router = createRouter({
    routeTree,
    context: { locale, queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
