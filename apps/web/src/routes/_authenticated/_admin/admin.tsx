import { createFileRoute, Outlet } from "@tanstack/react-router";
import { createI18n, createTranslator } from "@web/lib/i18n";

const i18n = createI18n({
  adminPanel: {
    en: "Admin panel",
    ru: "Админская панель",
  },
});

export const Route = createFileRoute("/_authenticated/_admin/admin")({
  component: Outlet,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("adminPanel")} · Coldbrew` }],
  }),
});
