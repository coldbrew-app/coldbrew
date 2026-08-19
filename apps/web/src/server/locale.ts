import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";

import { localeCookieName, resolveLocale } from "../lib/locale";

export const getRequestLocale = createServerFn({ method: "GET" }).handler(() =>
  resolveLocale(getCookie(localeCookieName), getRequestHeader("accept-language")),
);
