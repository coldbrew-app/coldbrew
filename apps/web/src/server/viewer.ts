import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getViewer } from "./api/_util.js";

export const getCurrentViewer = createServerFn({ method: "GET" }).handler(() =>
  getViewer(getRequest()),
);

export function currentViewerQueryOptions() {
  return queryOptions({
    queryKey: ["current-viewer"],
    queryFn: () => getCurrentViewer(),
    staleTime: 5 * 60 * 1000,
  });
}
