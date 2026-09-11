import type { DonationSource } from "@coldbrew/packages/schemas.js";
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

const sources = {
  donationalerts: {
    mark: "DA",
    markClassName: "from-orange-400 to-rose-500",
    name: "DonationAlerts",
    url: "https://www.donationalerts.com/dashboard/activity-feed/donations",
  },
  donate_stream: {
    mark: "d·s",
    markClassName: "from-sky-500 to-violet-600",
    name: "donate.stream",
    url: "https://lk.donate.stream/donate-alerts",
  },
  streamlabs: {
    mark: "SL",
    markClassName: "from-emerald-400 to-cyan-600",
    name: "Streamlabs",
    url: "https://streamlabs.com/dashboard",
  },
} satisfies Record<
  DonationSource,
  { mark: string; markClassName: string; name: string; url: string }
>;

export function donationSourceDetails(source: DonationSource) {
  return sources[source];
}

type MarkProps = {
  className?: string;
  size?: "sm" | "lg";
  source: DonationSource;
};

export function DonationSourceMark({ className, size = "sm", source }: MarkProps) {
  const { t } = useI18n(i18n);
  const details = sources[source];
  return (
    <a
      aria-label={t("openDonationSource", { source: details.name })}
      className={cn(
        "grid shrink-0 place-items-center bg-linear-to-br font-bold text-white transition-transform outline-none hover:-rotate-2 hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50",
        details.markClassName,
        size === "sm" ? "size-9 rounded-lg text-[11px]" : "size-12 rounded-xl text-sm shadow-sm",
        className,
      )}
      href={details.url}
      rel="noopener noreferrer"
      target="_blank"
    >
      {details.mark}
    </a>
  );
}

export function DonationSourceNameLink({
  className,
  source,
}: {
  className?: string;
  source: DonationSource;
}) {
  const { t } = useI18n(i18n);
  const details = sources[source];

  return (
    <a
      aria-label={t("openDonationSource", { source: details.name })}
      className={cn(
        "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      href={details.url}
      rel="noopener noreferrer"
      target="_blank"
    >
      {details.name}
    </a>
  );
}

export function DonationSourceConnectionStatus({ connected }: { connected: boolean }) {
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

export function DonationSourceBadge({
  className,
  source,
}: {
  className?: string;
  source: DonationSource;
}) {
  const { t } = useI18n(i18n);
  const details = sources[source];

  return (
    <a
      aria-label={t("openDonationSource", { source: details.name })}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors outline-none hover:border-primary/30 hover:bg-secondary hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      href={details.url}
      rel="noopener noreferrer"
      target="_blank"
    >
      {details.name}
      <Icons.externalLink aria-hidden="true" size={10} />
    </a>
  );
}
