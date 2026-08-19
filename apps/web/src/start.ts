import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";

import { localeCookieName, resolveLocale } from "./lib/locale";

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

const localeMiddleware = createMiddleware().server(({ next }) => {
  const cookieLocale = getCookie(localeCookieName);
  const locale = resolveLocale(cookieLocale, getRequestHeader("accept-language"));

  if (cookieLocale !== locale) {
    setCookie(localeCookieName, locale, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
    });
  }

  return next({ context: { locale } });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, localeMiddleware],
}));
