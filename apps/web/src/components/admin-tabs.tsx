import { Link } from "@tanstack/react-router";
import { Icons } from "@web/components/icons";
import { useI18n } from "@web/lib/i18n";

export function AdminTabs() {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("adminPanel")}
      className="flex max-w-full items-center gap-1.5 overflow-x-auto"
    >
      <Link
        activeOptions={{ includeSearch: false }}
        className="flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring data-[status=active]:focus-visible:outline-coffee-tab-foreground data-[status=active]:border-coffee-tab-border data-[status=active]:bg-coffee-tab data-[status=active]:font-semibold data-[status=active]:text-coffee-tab-foreground data-[status=active]:hover:bg-coffee-tab-hover [&_svg]:size-4"
        to="/admin/dlq"
      >
        <Icons.deadLetter aria-hidden="true" />
        {t("deadLetters")}
      </Link>
    </nav>
  );
}
