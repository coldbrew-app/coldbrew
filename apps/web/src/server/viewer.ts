import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getViewer } from "./api/_util.js";

export const getCurrentViewer = createServerFn({ method: "GET" }).handler(() =>
  getViewer(getRequest()),
);
