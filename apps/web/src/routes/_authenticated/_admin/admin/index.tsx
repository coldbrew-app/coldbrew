import type { ChatProvider } from "@streambrew/packages/chat.js";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { AdminTabs } from "@web/components/admin-tabs";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Icons, PlatformIcons } from "@web/components/icons";
import QueryErrorState from "@web/components/query-error-state";
import { Button } from "@web/components/ui/button";
import { Skeleton } from "@web/components/ui/skeleton";
import { useAdminDashboardQ } from "@web/hooks/api";
import { fmtDate } from "@web/lib/fmt";
import { createI18n, createTranslator, useI18n, type TranslationKey } from "@web/lib/i18n";
import { preloadRouteQuery } from "@web/lib/trpc";
import { cn } from "@web/lib/utils";
import type { AppRouter } from "@web/server/api/trpc/index";

const i18n = createI18n({
  overview: { en: "Overview", ru: "Обзор" },
  refresh: { en: "Refresh metrics", ru: "Обновить показатели" },
  noOperationalIssues: { en: "No operational issues", ru: "Отклонений нет" },
  attentionSummary: {
    en: ({ count }: { count: number }) => `${count} signals need attention`,
    ru: ({ count }: { count: number }) => `Требует внимания: ${count}`,
  },
  system: { en: "System", ru: "Система" },
  resources: { en: "Resources", ru: "Ресурсы" },
  loadAverage: { en: "Load average, 1 min", ru: "Средняя нагрузка, 1 мин" },
  loadCapacity: {
    en: ({ cpuCount, percent }: { cpuCount: number; percent: string }) =>
      `${percent} of ${cpuCount} CPU capacity`,
    ru: ({ cpuCount, percent }: { cpuCount: number; percent: string }) =>
      `${percent} мощности ${cpuCount} CPU`,
  },
  loadDetails: {
    en: ({ five, fifteen }: { five: string; fifteen: string }) =>
      `5 min ${five} · 15 min ${fifteen}`,
    ru: ({ five, fifteen }: { five: string; fifteen: string }) =>
      `5 мин ${five} · 15 мин ${fifteen}`,
  },
  memoryContainer: { en: "Web container memory", ru: "Память web-контейнера" },
  memorySystem: { en: "System memory", ru: "Оперативная память сервера" },
  memoryProcess: { en: "Web process memory", ru: "Память процесса web" },
  disk: { en: "Web container disk", ru: "Диск web-контейнера" },
  usedOf: {
    en: ({ total, used }: { total: string; used: string }) => `${used} of ${total}`,
    ru: ({ total, used }: { total: string; used: string }) => `${used} из ${total}`,
  },
  services: { en: "Services", ru: "Сервисы" },
  serviceWeb: { en: "Web", ru: "Web" },
  serviceDatabase: { en: "PostgreSQL", ru: "PostgreSQL" },
  serviceChat: { en: "Chat", ru: "Мультичат" },
  serviceDonations: { en: "Donations", ru: "Донаты" },
  serviceActivity: { en: "NATS activity tracking", ru: "NATS · активность" },
  healthy: { en: "Healthy", ru: "Работает" },
  unavailable: { en: "No response", ru: "Нет ответа" },
  latency: {
    en: ({ value }: { value: string }) => `${value} ms`,
    ru: ({ value }: { value: string }) => `${value} мс`,
  },
  databaseSummary: {
    en: ({
      connections,
      maxConnections,
      size,
    }: {
      connections: string;
      maxConnections: string;
      size: string;
    }) => `Database ${size} · connections ${connections}/${maxConnections}`,
    ru: ({
      connections,
      maxConnections,
      size,
    }: {
      connections: string;
      maxConnections: string;
      size: string;
    }) => `База ${size} · подключения ${connections}/${maxConnections}`,
  },
  webProcessSummary: {
    en: ({ memory, uptime }: { memory: string; uptime: string }) =>
      `Web RSS ${memory} · uptime ${uptime}`,
    ru: ({ memory, uptime }: { memory: string; uptime: string }) =>
      `Web RSS ${memory} · аптайм ${uptime}`,
  },
  serverUptime: {
    en: ({ uptime }: { uptime: string }) => `Server uptime ${uptime}`,
    ru: ({ uptime }: { uptime: string }) => `Аптайм сервера ${uptime}`,
  },
  userActivity: { en: "User activity", ru: "Активность пользователей" },
  uniqueStreamers: { en: "Unique streamers", ru: "Уникальные стримеры" },
  now: { en: "Now", ru: "Сейчас" },
  day: { en: "24 hours", ru: "24 часа" },
  week: { en: "7 days", ru: "7 дней" },
  month: { en: "30 days", ru: "30 дней" },
  multichat: { en: "Multichat", ru: "Мультичат" },
  overlay: { en: "OBS overlay", ru: "OBS-оверлей" },
  allChatSurfaces: { en: "Any chat surface", ru: "Любой экран чата" },
  donationUsers: { en: "Received donations", ru: "Получали донаты" },
  telemetryUnavailable: {
    en: "Live chat activity is temporarily unavailable.",
    ru: "Телеметрия подключений временно недоступна.",
  },
  trackingPartial: {
    en: ({ date }: { date: string }) =>
      `Connection history is collected since ${date}; longer periods are still partial.`,
    ru: ({ date }: { date: string }) =>
      `История подключений собирается с ${date}; длинные периоды пока неполные.`,
  },
  trackingComplete: {
    en: "Rolling activity window; one streamer is counted once in each period.",
    ru: "Скользящее окно активности; в каждом периоде стример учитывается один раз.",
  },
  productUsage: { en: "Product usage", ru: "Использование продукта" },
  totalStreamers: { en: "All streamers", ru: "Всего стримеров" },
  multichatConfigured: { en: "Configured multichat", ru: "Настроили мультичат" },
  overlaysConfigured: { en: "Created an OBS link", ru: "Создали OBS-ссылку" },
  adoptionShare: {
    en: ({ percent }: { percent: string }) => `${percent} of all streamers`,
    ru: ({ percent }: { percent: string }) => `${percent} от всех стримеров`,
  },
  chatConfigurationSummary: {
    en: ({ connections, sources }: { connections: string; sources: string }) =>
      `${connections} provider accounts · ${sources} enabled sources`,
    ru: ({ connections, sources }: { connections: string; sources: string }) =>
      `Аккаунтов провайдеров: ${connections} · активных источников: ${sources}`,
  },
  dynamics: { en: "Dynamics", ru: "Динамика" },
  registrations: { en: "New accounts", ru: "Новые аккаунты" },
  newMultichatConfigurations: {
    en: "New multichat setups",
    ru: "Новые настройки мультичата",
  },
  donationEvents: { en: "Donations received", ru: "Получено донатов" },
  providers: { en: "Chat providers", ru: "Платформы чата" },
  providerUsers: {
    en: ({ count }: { count: string }) => `Streamers ${count}`,
    ru: ({ count }: { count: string }) => `Стримеров: ${count}`,
  },
  providerConnections: {
    en: ({ count }: { count: string }) => `accounts ${count}`,
    ru: ({ count }: { count: string }) => `аккаунтов: ${count}`,
  },
  noProviders: {
    en: "No chat providers configured yet.",
    ru: "Провайдеры чата пока не настроены.",
  },
  processing: { en: "Processing and errors", ru: "Обработка и ошибки" },
  donationScans: { en: "Donation link parsing", ru: "Разбор ссылок из донатов" },
  videoMetadata: { en: "Video metadata", ru: "Метаданные видео" },
  alertPlayback: { en: "Alert playback", ru: "Воспроизведение алертов" },
  deadLetters: { en: "Dead letters", ru: "Ошибочные сообщения" },
  queueEmpty: { en: "Queue is empty", ru: "Очередь пуста" },
  pending: {
    en: ({ count }: { count: string }) => `Pending ${count}`,
    ru: ({ count }: { count: string }) => `В очереди: ${count}`,
  },
  retried: {
    en: ({ count }: { count: string }) => `retried ${count}`,
    ru: ({ count }: { count: string }) => `с повторами: ${count}`,
  },
  oldest: {
    en: ({ duration }: { duration: string }) => `oldest ${duration}`,
    ru: ({ duration }: { duration: string }) => `старейшая: ${duration}`,
  },
  alertsInProgress: {
    en: ({ count }: { count: string }) => `In progress ${count}`,
    ru: ({ count }: { count: string }) => `В работе: ${count}`,
  },
  alertsInterrupted: {
    en: ({ count }: { count: string }) => `interrupted in 24h ${count}`,
    ru: ({ count }: { count: string }) => `прервано за 24 часа: ${count}`,
  },
  deadLetterCount: {
    en: ({ count }: { count: string }) => `${count} stored`,
    ru: ({ count }: { count: string }) => `Сохранено: ${count}`,
  },
  metricUnavailable: { en: "No data", ru: "Нет данных" },
});

type Dashboard = inferRouterOutputs<AppRouter>["admin"]["dashboard"];
type ActivityPeriod = NonNullable<Dashboard["multichat"]["activity"]>["multichat"];
type Service = Dashboard["services"][number];

const providerMeta = {
  youtube: { label: "YouTube", logo: PlatformIcons.youtube },
  twitch: { label: "Twitch", logo: PlatformIcons.twitch },
  kick: { label: "Kick", logo: PlatformIcons.kick },
  boosty: { label: "Boosty", logo: PlatformIcons.boosty },
  vk_video: { label: "VK Video", logo: PlatformIcons.vk_video },
} as const satisfies Record<ChatProvider, { label: string; logo: string }>;

const serviceLabels = {
  web: "serviceWeb",
  database: "serviceDatabase",
  chat: "serviceChat",
  donations: "serviceDonations",
  activity: "serviceActivity",
} as const satisfies Record<Service["id"], TranslationKey<typeof i18n>>;

export const Route = createFileRoute("/_authenticated/_admin/admin/")({
  component: AdminOverviewPage,
  loader: async ({ context }) => {
    await preloadRouteQuery(context.queryClient, context.trpc.admin.dashboard.queryOptions());
  },
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("overview")} · StreamBrew` }],
  }),
});

function AdminOverviewPage() {
  const dashboardQ = useAdminDashboardQ();
  const { t } = useI18n(i18n);
  const attentionCount = dashboardQ.data ? getAttentionCount(dashboardQ.data) : 0;

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader
        actions={
          <div className="flex items-center gap-2">
            {dashboardQ.data && (
              <span
                className={cn(
                  "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold sm:flex",
                  attentionCount === 0
                    ? "border-emerald-200/30 bg-emerald-950/50 text-emerald-100"
                    : "border-amber-200/40 bg-amber-950/60 text-amber-100",
                )}
              >
                {attentionCount === 0 ? (
                  <Icons.checked aria-hidden="true" size={14} />
                ) : (
                  <Icons.warn aria-hidden="true" size={14} />
                )}
                {attentionCount === 0
                  ? t("noOperationalIssues")
                  : t("attentionSummary", { count: attentionCount })}
              </span>
            )}
            <Button
              aria-label={t("refresh")}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={dashboardQ.isFetching}
              onClick={() => void dashboardQ.refetch()}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <Icons.retry
                aria-hidden="true"
                className={dashboardQ.isFetching ? "animate-spin" : undefined}
              />
            </Button>
          </div>
        }
        navigation={<AdminTabs />}
        title={t("overview")}
        variant="signal"
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {dashboardQ.isLoading ? (
          <AdminDashboardSkeleton />
        ) : dashboardQ.isError ? (
          <QueryErrorState
            className="min-h-full"
            isRetrying={dashboardQ.isFetching}
            onRetry={() => void dashboardQ.refetch()}
          />
        ) : dashboardQ.data ? (
          <AdminDashboard dashboard={dashboardQ.data} />
        ) : null}
      </div>
    </section>
  );
}

function AdminDashboard({ dashboard }: { dashboard: Dashboard }) {
  return (
    <div className="flex flex-col gap-7 p-4 sm:p-5">
      <SystemSection dashboard={dashboard} />
      <ActivitySection dashboard={dashboard} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
        <ProductSection dashboard={dashboard} />
        <ProcessingSection dashboard={dashboard} />
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="font-heading text-xl leading-tight font-semibold tracking-tight">{children}</h2>
  );
}

function SystemSection({ dashboard }: { dashboard: Dashboard }) {
  const { locale, t } = useI18n(i18n);
  const [oneMinute, fiveMinutes, fifteenMinutes] = dashboard.system.loadAverage;
  const loadRatio = oneMinute / dashboard.system.cpuCount;
  const memoryRatio = dashboard.system.memory.usedBytes / dashboard.system.memory.totalBytes;
  const diskRatio = dashboard.system.disk
    ? dashboard.system.disk.usedBytes / dashboard.system.disk.totalBytes
    : null;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t("system")}</SectionHeading>
      <div className="grid overflow-hidden rounded-xl border border-border lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)] lg:divide-x lg:divide-border">
        <div className="min-w-0">
          <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
            {t("resources")}
          </h3>
          <div className="divide-y divide-border">
            <ResourceRow
              detail={t("loadDetails", {
                five: formatDecimal(fiveMinutes, locale),
                fifteen: formatDecimal(fifteenMinutes, locale),
              })}
              label={t("loadAverage")}
              ratio={loadRatio}
              summary={t("loadCapacity", {
                cpuCount: dashboard.system.cpuCount,
                percent: formatPercent(loadRatio, locale),
              })}
              value={formatDecimal(oneMinute, locale)}
            />
            <ResourceRow
              detail={t("usedOf", {
                used: formatBytes(dashboard.system.memory.usedBytes, locale),
                total: formatBytes(dashboard.system.memory.totalBytes, locale),
              })}
              label={t(
                dashboard.system.memoryScope === "container"
                  ? "memoryContainer"
                  : dashboard.system.memoryScope === "system"
                    ? "memorySystem"
                    : "memoryProcess",
              )}
              ratio={memoryRatio}
              summary={formatPercent(memoryRatio, locale)}
              value={formatBytes(dashboard.system.memory.usedBytes, locale)}
            />
            <ResourceRow
              detail={
                dashboard.system.disk
                  ? t("usedOf", {
                      used: formatBytes(dashboard.system.disk.usedBytes, locale),
                      total: formatBytes(dashboard.system.disk.totalBytes, locale),
                    })
                  : t("metricUnavailable")
              }
              label={t("disk")}
              ratio={diskRatio}
              summary={diskRatio === null ? "—" : formatPercent(diskRatio, locale)}
              value={
                dashboard.system.disk ? formatBytes(dashboard.system.disk.usedBytes, locale) : "—"
              }
            />
          </div>
        </div>
        <div className="min-w-0 border-t border-border lg:border-t-0">
          <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
            {t("services")}
          </h3>
          <div className="divide-y divide-border">
            {dashboard.services.map((service) => (
              <ServiceRow key={service.id} service={service} />
            ))}
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border bg-muted/30 px-4 py-3 text-[11px] leading-5 text-muted-foreground tabular-nums">
            <span>
              {t("databaseSummary", {
                size: formatBytes(dashboard.database.sizeBytes, locale),
                connections: formatNumber(dashboard.database.connections, locale),
                maxConnections: formatNumber(dashboard.database.maxConnections, locale),
              })}
            </span>
            <span>
              {t("webProcessSummary", {
                memory: formatBytes(dashboard.system.webRssBytes, locale),
                uptime: formatDuration(dashboard.system.webUptimeSeconds, locale),
              })}
            </span>
            <span>
              {t("serverUptime", {
                uptime: formatDuration(dashboard.system.serverUptimeSeconds, locale),
              })}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ResourceRow({
  detail,
  label,
  ratio,
  summary,
  value,
}: {
  detail: string;
  label: string;
  ratio: number | null;
  summary: string;
  value: string;
}) {
  const width = ratio === null ? 0 : Math.min(100, Math.max(0, ratio * 100));
  const tone =
    ratio === null
      ? "bg-muted-foreground/30"
      : ratio >= 0.9
        ? "bg-destructive"
        : ratio >= 0.7
          ? "bg-amber-500"
          : "bg-primary";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="truncate text-[11px] text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <div className="flex items-baseline gap-2 text-right tabular-nums">
        <span className="text-base font-semibold text-foreground">{value}</span>
        <span className="text-[11px] text-muted-foreground">{summary}</span>
      </div>
      {ratio !== null && (
        <div
          aria-label={`${label}: ${summary}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(width)}
          className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
        </div>
      )}
    </div>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const { locale, t } = useI18n(i18n);
  const healthy = service.status === "healthy";

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
      <span className="min-w-0 truncate font-medium text-foreground">
        {t(serviceLabels[service.id])}
      </span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums">
        <span className={healthy ? "text-muted-foreground" : "font-medium text-destructive"}>
          {t(healthy ? "healthy" : "unavailable")}
        </span>
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", healthy ? "bg-emerald-500" : "bg-destructive")}
        />
        <span className="w-12 text-right text-[11px] text-muted-foreground">
          {t("latency", { value: formatDecimal(service.latencyMs, locale, 0) })}
        </span>
      </span>
    </div>
  );
}

function ActivitySection({ dashboard }: { dashboard: Dashboard }) {
  const { locale, t } = useI18n(i18n);
  const activity = dashboard.multichat.activity;
  const coverageDays = activity
    ? (dashboard.capturedAt.getTime() - activity.trackingSince.getTime()) / 86_400_000
    : 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionHeading>{t("userActivity")}</SectionHeading>
        <span className="text-xs text-muted-foreground">{t("uniqueStreamers")}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead className="bg-muted/40 text-[11px] font-medium text-muted-foreground">
              <tr>
                <th className="min-w-28 px-3 py-2.5 text-left font-medium sm:px-4" scope="col">
                  {t("uniqueStreamers")}
                </th>
                {(["now", "day", "week", "month"] as const).map((key) => (
                  <th
                    className="w-14 px-2 py-2.5 text-right font-medium whitespace-nowrap sm:w-24 sm:px-3"
                    key={key}
                    scope="col"
                  >
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <ActivityRow label={t("multichat")} period={activity?.multichat ?? null} />
              <ActivityRow label={t("overlay")} period={activity?.overlay ?? null} />
              <ActivityRow
                emphasized
                label={t("allChatSurfaces")}
                period={activity?.total ?? null}
              />
              <ActivityRow
                label={t("donationUsers")}
                period={{ now: null, ...dashboard.users.activeByDonations }}
              />
            </tbody>
          </table>
        </div>
        <div
          className={cn(
            "border-t border-border px-4 py-2.5 text-[11px] leading-5",
            activity ? "text-muted-foreground" : "bg-destructive/5 text-destructive",
          )}
        >
          {activity === null
            ? t("telemetryUnavailable")
            : coverageDays < 30
              ? t("trackingPartial", { date: fmtDate(activity.trackingSince, locale) })
              : t("trackingComplete")}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({
  emphasized = false,
  label,
  period,
}: {
  emphasized?: boolean;
  label: string;
  period: (Omit<ActivityPeriod, "now"> & { now: number | null }) | null;
}) {
  const { locale } = useI18n(i18n);
  return (
    <tr className={emphasized ? "bg-muted/25" : undefined}>
      <th
        className={cn("px-3 py-3 text-left font-medium sm:px-4", emphasized && "font-semibold")}
        scope="row"
      >
        {label}
      </th>
      {(["now", "day", "week", "month"] as const).map((key) => (
        <td className={cn("px-2 py-3 text-right sm:px-3", emphasized && "font-semibold")} key={key}>
          {period?.[key] === null || period === null ? "—" : formatNumber(period[key], locale)}
        </td>
      ))}
    </tr>
  );
}

function ProductSection({ dashboard }: { dashboard: Dashboard }) {
  const { locale, t } = useI18n(i18n);
  const adoption = [
    { label: t("totalStreamers"), value: dashboard.users.total, share: null },
    {
      label: t("multichatConfigured"),
      value: dashboard.multichat.configuredUsers,
      share: ratio(dashboard.multichat.configuredUsers, dashboard.users.total),
    },
    {
      label: t("overlaysConfigured"),
      value: dashboard.multichat.overlaysConfigured,
      share: ratio(dashboard.multichat.overlaysConfigured, dashboard.users.total),
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeading>{t("productUsage")}</SectionHeading>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {adoption.map((item) => (
            <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5" key={item.label}>
              <span className="text-[11px] font-medium text-muted-foreground">{item.label}</span>
              <span className="text-xl font-semibold text-foreground tabular-nums">
                {formatNumber(item.value, locale)}
              </span>
              {item.share !== null && (
                <span className="text-[11px] text-muted-foreground">
                  {t("adoptionShare", { percent: formatPercent(item.share, locale) })}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground tabular-nums">
          {t("chatConfigurationSummary", {
            connections: formatNumber(dashboard.multichat.connectionCount, locale),
            sources: formatNumber(dashboard.multichat.enabledSourceCount, locale),
          })}
        </div>
        <div className="border-t border-border">
          <h3 className="px-4 pt-3 pb-1 text-sm font-semibold">{t("dynamics")}</h3>
          <PeriodTable
            rows={[
              { label: t("registrations"), values: dashboard.users.registered },
              {
                label: t("newMultichatConfigurations"),
                values: dashboard.multichat.newlyConfigured,
              },
              { label: t("donationEvents"), values: dashboard.traffic.donations },
            ]}
          />
        </div>
        <div className="border-t border-border px-4 py-3.5">
          <h3 className="pb-3 text-sm font-semibold">{t("providers")}</h3>
          {dashboard.multichat.providers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noProviders")}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {dashboard.multichat.providers.map((provider) => (
                <ProviderRow key={provider.provider} provider={provider} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PeriodTable({
  rows,
}: {
  rows: Array<{ label: string; values: { day: number; week: number; month: number } }>;
}) {
  const { locale, t } = useI18n(i18n);
  return (
    <table className="w-full border-collapse text-xs tabular-nums">
      <thead className="text-[11px] font-medium text-muted-foreground">
        <tr>
          <th className="px-4 py-2 text-left font-medium" scope="col" />
          {(["day", "week", "month"] as const).map((key) => (
            <th className="w-20 px-3 py-2 text-right font-medium" key={key} scope="col">
              {t(key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr key={row.label}>
            <th className="px-4 py-2.5 text-left font-medium" scope="row">
              {row.label}
            </th>
            {(["day", "week", "month"] as const).map((key) => (
              <td className="px-3 py-2.5 text-right" key={key}>
                {formatNumber(row.values[key], locale)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProviderRow({ provider }: { provider: Dashboard["multichat"]["providers"][number] }) {
  const { locale, t } = useI18n(i18n);
  const meta = providerMeta[provider.provider];
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
      <img alt="" aria-hidden="true" className="size-5 shrink-0" src={meta.logo} />
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-xs font-semibold">{meta.label}</span>
        <span className="truncate text-[11px] text-muted-foreground tabular-nums">
          {t("providerUsers", { count: formatNumber(provider.users, locale) })}
          {provider.connections !== provider.users &&
            ` · ${t("providerConnections", { count: formatNumber(provider.connections, locale) })}`}
        </span>
      </div>
    </div>
  );
}

function ProcessingSection({ dashboard }: { dashboard: Dashboard }) {
  const { locale, t } = useI18n(i18n);
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeading>{t("processing")}</SectionHeading>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        <QueueRow
          attention={dashboard.queues.donationScans.retried > 0}
          detail={queueDetail(
            dashboard.queues.donationScans.pending,
            dashboard.queues.donationScans.retried,
            dashboard.queues.donationScans.oldestSeconds,
            locale,
            t,
          )}
          label={t("donationScans")}
          value={dashboard.queues.donationScans.pending}
        />
        <QueueRow
          attention={dashboard.queues.videoMetadata.retried > 0}
          detail={queueDetail(
            dashboard.queues.videoMetadata.pending,
            dashboard.queues.videoMetadata.retried,
            dashboard.queues.videoMetadata.oldestSeconds,
            locale,
            t,
          )}
          label={t("videoMetadata")}
          value={dashboard.queues.videoMetadata.pending}
        />
        <QueueRow
          attention={dashboard.queues.alerts.interruptedDay > 0}
          detail={`${t("alertsInProgress", { count: formatNumber(dashboard.queues.alerts.inProgress, locale) })} · ${t("alertsInterrupted", { count: formatNumber(dashboard.queues.alerts.interruptedDay, locale) })}`}
          label={t("alertPlayback")}
          value={dashboard.queues.alerts.inProgress}
        />
        <Link
          className="flex items-center justify-between gap-4 px-4 py-3.5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          to="/admin/dlq"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium text-foreground">{t("deadLetters")}</span>
            <span
              className={cn(
                "text-[11px]",
                dashboard.queues.deadLetters && dashboard.queues.deadLetters > 0
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {dashboard.queues.deadLetters === null
                ? t("metricUnavailable")
                : t("deadLetterCount", {
                    count: formatNumber(dashboard.queues.deadLetters, locale),
                  })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 tabular-nums">
            <span
              className={cn(
                "text-lg font-semibold",
                dashboard.queues.deadLetters && dashboard.queues.deadLetters > 0
                  ? "text-destructive"
                  : "text-foreground",
              )}
            >
              {dashboard.queues.deadLetters === null
                ? "—"
                : formatNumber(dashboard.queues.deadLetters, locale)}
            </span>
            <Icons.chevronRight aria-hidden="true" className="text-muted-foreground" size={16} />
          </div>
        </Link>
      </div>
    </section>
  );
}

function QueueRow({
  attention,
  detail,
  label,
  value,
}: {
  attention: boolean;
  detail: string;
  label: string;
  value: number;
}) {
  const { locale } = useI18n(i18n);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "text-[11px]",
            attention ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
          )}
        >
          {detail}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 text-lg font-semibold tabular-nums",
          attention ? "text-amber-700 dark:text-amber-300" : "text-foreground",
        )}
      >
        {formatNumber(value, locale)}
      </span>
    </div>
  );
}

function queueDetail(
  pending: number,
  retried: number,
  oldestSeconds: number | null,
  locale: "en" | "ru",
  t: ReturnType<typeof useI18n<typeof i18n>>["t"],
) {
  if (pending === 0) return t("queueEmpty");
  const details = [
    t("pending", { count: formatNumber(pending, locale) }),
    ...(retried > 0 ? [t("retried", { count: formatNumber(retried, locale) })] : []),
    ...(oldestSeconds === null
      ? []
      : [t("oldest", { duration: formatDuration(oldestSeconds, locale) })]),
  ];
  return details.join(" · ");
}

function getAttentionCount(dashboard: Dashboard) {
  const systemRatios = [
    dashboard.system.loadAverage[0] / dashboard.system.cpuCount,
    dashboard.system.memory.usedBytes / dashboard.system.memory.totalBytes,
    ...(dashboard.system.disk
      ? [dashboard.system.disk.usedBytes / dashboard.system.disk.totalBytes]
      : []),
    dashboard.database.connections / dashboard.database.maxConnections,
  ];
  return (
    dashboard.services.filter((service) => service.status === "unavailable").length +
    systemRatios.filter((value) => value >= 0.9).length +
    Number(dashboard.system.disk === null) +
    Number(dashboard.queues.donationScans.retried > 0) +
    Number(dashboard.queues.videoMetadata.retried > 0) +
    Number(dashboard.queues.alerts.interruptedDay > 0) +
    Number(dashboard.queues.deadLetters === null || dashboard.queues.deadLetters > 0)
  );
}

function ratio(value: number, total: number) {
  return total === 0 ? 0 : value / total;
}

function formatNumber(value: number, locale: "en" | "ru") {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US").format(value);
}

function formatDecimal(value: number, locale: "en" | "ru", maximumFractionDigits = 2) {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  }).format(value);
}

function formatPercent(value: number, locale: "en" | "ru") {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(value);
}

function formatBytes(bytes: number, locale: "en" | "ru") {
  const units =
    locale === "ru" ? ["Б", "КиБ", "МиБ", "ГиБ", "ТиБ"] : ["B", "KiB", "MiB", "GiB", "TiB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number, locale: "en" | "ru") {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return locale === "ru" ? `${days} д ${hours} ч` : `${days}d ${hours}h`;
  if (hours > 0) return locale === "ru" ? `${hours} ч ${minutes} мин` : `${hours}h ${minutes}m`;
  return locale === "ru" ? `${minutes} мин` : `${minutes}m`;
}

function AdminDashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-7 p-4 sm:p-5">
      {[0, 1].map((section) => (
        <div className="flex flex-col gap-3" key={section}>
          <Skeleton className="h-6 w-44" />
          <div className="grid overflow-hidden rounded-xl border border-border lg:grid-cols-2">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-border px-4 py-4"
                key={row}
              >
                <div className="flex grow flex-col gap-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2.5 w-44 max-w-full" />
                </div>
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
