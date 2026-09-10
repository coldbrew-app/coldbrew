import { Button } from "@web/components/ui/button";
import { cn } from "@web/lib/utils";
import type { ComponentProps } from "react";

import { createI18n, useI18n } from "../lib/i18n";
import { CosmicArt } from "./cosmic-art";
import { Icons } from "./icons";

const i18n = createI18n({
  dataLoadError: {
    en: "Couldn't load data",
    ru: "Не удалось загрузить данные",
  },
  dataLoadErrorDescription: {
    en: "Check your connection and try again.",
    ru: "Проверьте подключение и попробуйте ещё раз.",
  },
  tryAgain: {
    en: "Try again",
    ru: "Повторить",
  },
  retrying: {
    en: "Retrying…",
    ru: "Загружаем снова…",
  },
});

type Props = ComponentProps<"div"> & {
  isRetrying?: boolean;
  onRetry: () => void;
};

export default function QueryErrorState({
  className,
  isRetrying = false,
  onRetry,
  ...props
}: Props) {
  const { t } = useI18n(i18n);

  return (
    <div
      className={cn("grid min-h-40 place-items-center p-5 text-center", className)}
      role="alert"
      {...props}
    >
      <div className="relative flex max-w-sm flex-col items-center gap-3 overflow-hidden">
        <CosmicArt
          className="absolute -top-6 -right-20 w-32 text-destructive/20 opacity-20"
          variant="beans"
        />
        <div className="grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <Icons.warn aria-hidden="true" size={18} />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">{t("dataLoadError")}</h2>
          <p className="text-xs text-muted-foreground">{t("dataLoadErrorDescription")}</p>
        </div>
        <Button disabled={isRetrying} onClick={onRetry} size="sm" type="button" variant="outline">
          <Icons.retry aria-hidden="true" className={isRetrying ? "animate-spin" : undefined} />
          {t(isRetrying ? "retrying" : "tryAgain")}
        </Button>
      </div>
    </div>
  );
}
