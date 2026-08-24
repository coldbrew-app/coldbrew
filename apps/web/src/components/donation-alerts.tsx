import { cn } from "@web/lib/utils";

import { useI18n } from "../lib/i18n";

export const DONATION_ALERTS_NAME = "DonationAlerts";

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
  const { t } = useI18n();

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
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {DONATION_ALERTS_NAME}
    </span>
  );
}
