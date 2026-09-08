import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_admin")({
  beforeLoad: ({ context }) => {
    if (!context.viewer?.isAdmin) {
      throw redirect({ to: "/" });
    }
  },
  component: Outlet,
});
