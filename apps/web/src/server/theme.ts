import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import { resolveTheme, themeCookieName } from "../lib/theme";

export const getRequestTheme = createServerFn({ method: "GET" }).handler(() =>
  resolveTheme(getCookie(themeCookieName)),
);
