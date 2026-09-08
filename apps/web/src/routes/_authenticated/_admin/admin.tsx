import { createFileRoute, Outlet } from "@tanstack/react-router";
import { createTranslator } from "@web/lib/i18n";

export const Route = createFileRoute("/_authenticated/_admin/admin")({
  component: Outlet,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("adminPanel")} · Coldbrew` }],
  }),
});
