import { useI18n } from "@web/lib/i18n";

import { Icons } from "./icons";
import { Button } from "./ui/button";

export type PaginationItem = number | "ellipsis";

export function getPaginationItems(page: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((item) => item >= 1 && item <= totalPages)
    .toSorted((left, right) => left - right);

  return pages.flatMap((item, index) => {
    const previous = pages[index - 1];
    return previous !== undefined && item - previous > 1 ? ["ellipsis" as const, item] : [item];
  });
}

type Props = {
  disabled?: boolean;
  isLoading?: boolean;
  loadingLabel: string;
  onPageChange: (page: number) => void;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function PagePagination({
  disabled = false,
  isLoading = false,
  loadingLabel,
  onPageChange,
  page,
  pageSize,
  total,
  totalPages,
}: Props) {
  const { t } = useI18n();
  if (total === 0) {
    return null;
  }

  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={t("pagination")}
      className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:px-5"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 sm:contents">
        <span className="truncate text-[11px] text-muted-foreground sm:col-start-1">
          {t("showingResults", { first: firstItem, last: lastItem, total })}
        </span>
        {isLoading && (
          <output className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground sm:col-start-3 sm:justify-self-end">
            <Icons.loader aria-hidden="true" className="animate-spin" size={14} />
            <span>{loadingLabel}</span>
          </output>
        )}
      </div>
      {totalPages > 1 && (
        <div className="flex self-center rounded-xl border border-border bg-secondary/35 p-1 shadow-sm sm:col-start-2 sm:row-start-1">
          <Button
            aria-label={t("previousPage")}
            className="shadow-sm"
            disabled={disabled || isLoading || page === 1}
            onClick={() => onPageChange(page - 1)}
            size="icon"
            type="button"
            variant="outline"
          >
            <Icons.chevronLeft aria-hidden="true" />
          </Button>
          <span className="px-2 text-xs font-semibold text-muted-foreground sm:hidden">
            {t("pageOf", { page, totalPages })}
          </span>
          <div className="hidden items-center gap-1 sm:mx-2 sm:flex">
            {getPaginationItems(page, totalPages).map((item, index) =>
              item === "ellipsis" ? (
                <span
                  aria-hidden="true"
                  className="grid size-7 place-items-center text-xs text-muted-foreground"
                  key={`ellipsis-${index}`}
                >
                  …
                </span>
              ) : (
                <Button
                  aria-current={item === page ? "page" : undefined}
                  aria-label={t("goToPage", { page: item })}
                  className={item === page ? "shadow-sm" : undefined}
                  disabled={disabled || isLoading}
                  key={item}
                  onClick={() => onPageChange(item)}
                  size="icon"
                  type="button"
                  variant={item === page ? "default" : "outline"}
                >
                  {item}
                </Button>
              ),
            )}
          </div>
          <Button
            aria-label={t("nextPage")}
            className="shadow-sm"
            disabled={disabled || isLoading || page === totalPages}
            onClick={() => onPageChange(page + 1)}
            size="icon"
            type="button"
            variant="outline"
          >
            <Icons.chevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
