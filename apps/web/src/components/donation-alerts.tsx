import { cn } from "@web/lib/utils";

import { createI18n, useI18n } from "../lib/i18n";
import { Icons } from "./icons";

const i18n = createI18n({
  connected: {
    en: "Connected",
    ru: "Подключено",
  },
  notConnected: {
    en: "Not connected",
    ru: "Не подключено",
  },
  openDonationSource: {
    en: ({ source }: { source: string }) => `Open ${source}`,
    ru: ({ source }: { source: string }) => `Открыть ${source}`,
  },
});

export const DONATION_ALERTS_NAME = "DonationAlerts";
export const DONATION_ALERTS_DONATIONS_URL = "https://www.donationalerts.com/dashboard/donations";

type MarkProps = {
  className?: string;
  size?: "sm" | "lg";
};

export function DonationAlertsMark({ className, size = "sm" }: MarkProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center bg-linear-to-br from-orange-400 to-rose-500 font-bold text-white",
        size === "sm" ? "size-9 rounded-lg text-[11px]" : "size-12 rounded-xl text-sm shadow-sm",
        className,
      )}
    >
      DA
    </div>
  );
}

export function DonationAlertsConnectionStatus({ connected }: { connected: boolean }) {
  const { t } = useI18n(i18n);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
        connected
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
          : "bg-orange-50 text-orange-600 dark:bg-orange-400/10 dark:text-orange-300",
      )}
    >
      <i aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {t(connected ? "connected" : "notConnected")}
    </span>
  );
}

export function DonationAlertsSourceBadge({ className }: { className?: string }) {
  const { t } = useI18n(i18n);

  return (
    <a
      aria-label={t("openDonationSource", { source: DONATION_ALERTS_NAME })}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors outline-none hover:border-primary/30 hover:bg-secondary hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      href={DONATION_ALERTS_DONATIONS_URL}
      rel="noopener noreferrer"
      target="_blank"
    >
      {DONATION_ALERTS_NAME}
      <Icons.externalLink aria-hidden="true" size={10} />
    </a>
  );
}
