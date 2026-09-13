import { Link } from "@tanstack/react-router";
import { Icons } from "@web/components/icons";
import { createI18n, useI18n } from "@web/lib/i18n";

const i18n = createI18n({
  adminPanel: {
    en: "Admin panel",
    ru: "Админская панель",
  },
  overview: {
    en: "Overview",
    ru: "Обзор",
  },
  deadLetters: {
    en: "Dead letters",
    ru: "Ошибочные сообщения",
  },
});

const tabClassName =
  "flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-transparent px-3 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white/70 data-[status=active]:focus-visible:outline-coffee-tab-foreground data-[status=active]:border-coffee-tab-border data-[status=active]:bg-coffee-tab data-[status=active]:font-semibold data-[status=active]:text-coffee-tab-foreground data-[status=active]:hover:bg-coffee-tab-hover [&_svg]:size-4";

export function AdminTabs() {
  const { t } = useI18n(i18n);

  return (
    <nav
      aria-label={t("adminPanel")}
      className="flex max-w-full items-center gap-1.5 overflow-x-auto"
    >
      <Link
        activeOptions={{ exact: true, includeSearch: false }}
        className={tabClassName}
        to="/admin"
      >
        <Icons.dashboard aria-hidden="true" />
        {t("overview")}
      </Link>
      <Link activeOptions={{ includeSearch: false }} className={tabClassName} to="/admin/dlq">
        <Icons.deadLetter aria-hidden="true" />
        {t("deadLetters")}
      </Link>
    </nav>
  );
}
