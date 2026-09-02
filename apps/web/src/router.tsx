import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { parseCookie } from "cookie-es";

import { localeCookieName, resolveLocale } from "./lib/locale";
import { resolveTheme, themeCookieName } from "./lib/theme";
import { createApi } from "./lib/trpc";
import { routeTree } from "./routeTree.gen";

function getInitialLocale() {
  if (typeof document === "undefined") {
    return "en" as const;
  }
  return resolveLocale(parseCookie(document.cookie)[localeCookieName], navigator.language);
}

function getInitialTheme() {
  if (typeof document === "undefined") {
    return "light" as const;
  }
  return resolveTheme(parseCookie(document.cookie)[themeCookieName]);
}

export function getRouter() {
  const locale = getInitialLocale();
  const theme = getInitialTheme();
  const api = createApi();
  const router = createRouter({
    routeTree,
    context: { locale, theme, viewer: null, ...api },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: api.queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
