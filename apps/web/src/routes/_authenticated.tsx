import { createFileRoute } from "@tanstack/react-router";

import { AuthenticatedRoot } from "./__root";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedRoot,
  loader: async ({ context }) => {
    if (!context.viewer) {
      return;
    }
    await context.queryClient.ensureQueryData(context.trpc.userInfo.queryOptions());
  },
});
