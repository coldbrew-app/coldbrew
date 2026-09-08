import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_admin/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/dlq", replace: true });
  },
});
