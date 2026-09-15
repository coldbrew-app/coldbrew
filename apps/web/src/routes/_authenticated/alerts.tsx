import {
  AlertAssetSchema,
  AlertPlaybackSchema,
  AlertSettingsSchema,
  type AlertDiagnosticCode,
  type AlertAssetKind,
  type AlertPlayback,
  type AlertSettings,
} from "@streambrew/packages/alerts.js";
import { DonationSourceSchema, type DonationSource } from "@streambrew/packages/schemas.js";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { AlertPlayer } from "@web/components/alert-player";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import {
  donationSourceDetails,
  DonationSourceConnectionStatus,
  DonationSourceMark,
} from "@web/components/donation-source";
import { Icons } from "@web/components/icons";
import QueryErrorState from "@web/components/query-error-state";
import { Button } from "@web/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@web/components/ui/field";
import { Input } from "@web/components/ui/input";
import { Skeleton } from "@web/components/ui/skeleton";
import { Switch } from "@web/components/ui/switch";
import { useAlertDashboard, useAlertMutations } from "@web/hooks/alerts";
import { fmtAmount, fmtListDate } from "@web/lib/fmt";
import { createI18n, createTranslator, useI18n } from "@web/lib/i18n";
import { preloadRouteQuery } from "@web/lib/trpc";
import { cn } from "@web/lib/utils";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

const i18n = createI18n({
  alerts: { en: "Donation alerts", ru: "Алерты донатов" },
  connected: { en: "Connected", ru: "Подключено" },
  standby: { en: "Standby", ru: "Ожидание" },
  offline: { en: "Offline", ru: "Не в сети" },
  hiddenSource: { en: "Browser Source is hidden", ru: "Browser Source скрыт" },
  activeSource: { en: "Browser Source is active", ru: "Browser Source активен" },
  noSource: { en: "Open the widget in OBS to connect", ru: "Откройте виджет в OBS" },
  pause: { en: "Pause", ru: "Пауза" },
  resume: { en: "Resume", ru: "Продолжить" },
  skip: { en: "Skip", ru: "Пропустить" },
  testInObs: { en: "Test in OBS", ru: "Тест в OBS" },
  preview: { en: "Preview · 800 × 600", ru: "Предпросмотр · 800 × 600" },
  previewDescription: {
    en: "Play the same animation and sound that will run inside OBS.",
    ru: "Запустите ту же анимацию и звук, которые будут работать в OBS.",
  },
  playPreview: { en: "Play preview", ru: "Запустить предпросмотр" },
  obsLink: { en: "Secret OBS link", ru: "Секретная ссылка OBS" },
  obsLinkDescription: {
    en: "Add it as a Browser Source at 800 × 600. Treat this URL like a password.",
    ru: "Добавьте её как Browser Source размером 800 × 600. Храните ссылку как пароль.",
  },
  openObsGuide: {
    en: "Open the OBS Browser Source guide",
    ru: "Открыть справку OBS о Browser Source",
  },
  createLink: { en: "Create link", ru: "Создать ссылку" },
  rotateLink: { en: "Rotate link", ru: "Обновить ссылку" },
  copy: { en: "Copy", ru: "Копировать" },
  copied: { en: "Copied", ru: "Скопировано" },
  hiddenLink: {
    en: "A link already exists. Rotate it to reveal a new one.",
    ru: "Ссылка уже создана. Обновите её, чтобы получить новую.",
  },
  missingLink: {
    en: "Create a link to connect your first OBS Browser Source.",
    ru: "Создайте ссылку, чтобы подключить первый Browser Source в OBS.",
  },
  linkCreated: {
    en: "Copy this link now. It will be hidden after you leave the page.",
    ru: "Скопируйте ссылку сейчас. После ухода со страницы она будет скрыта.",
  },
  settings: { en: "Presentation", ru: "Оформление" },
  alertsEnabled: { en: "Accept new alerts", ru: "Принимать новые алерты" },
  alertsEnabledDescription: {
    en: "When disabled, new donations are not added to the alert queue.",
    ru: "Если выключить, новые донаты не будут попадать в очередь алертов.",
  },
  duration: { en: "Minimum time on screen", ru: "Минимальное время на экране" },
  seconds: {
    en: ({ value }: { value: number }) => `${value} s`,
    ru: ({ value }: { value: number }) => `${value} с`,
  },
  accent: { en: "Accent color", ru: "Цвет акцента" },
  sources: { en: "Donation sources", ru: "Источники донатов" },
  sourcesDescription: {
    en: "Only enabled and connected sources can create alerts.",
    ru: "Алерты создают только включённые и подключённые источники.",
  },
  media: { en: "Image and sound", ru: "Изображение и звук" },
  image: { en: "Alert image", ru: "Изображение алерта" },
  sound: { en: "Alert sound", ru: "Звук алерта" },
  imageLimits: {
    en: "PNG, JPEG, WebP, or GIF · up to 4 MiB",
    ru: "PNG, JPEG, WebP или GIF · до 4 МиБ",
  },
  soundLimits: {
    en: "WAV, MP3, Ogg, or Opus · up to 10 MiB and 30 s",
    ru: "WAV, MP3, Ogg или Opus · до 10 МиБ и 30 с",
  },
  upload: { en: "Upload", ru: "Загрузить" },
  replace: { en: "Replace", ru: "Заменить" },
  remove: { en: "Remove", ru: "Удалить" },
  uploaded: { en: "Uploaded", ru: "Загружено" },
  uploadFailed: { en: "The file could not be uploaded.", ru: "Не удалось загрузить файл." },
  unsupportedFile: {
    en: "Choose a supported file within the size limit.",
    ru: "Выберите поддерживаемый файл допустимого размера.",
  },
  assetSize: {
    en: ({ value }: { value: string }) => `${value} MiB`,
    ru: ({ value }: { value: string }) => `${value} МиБ`,
  },
  soundVolume: { en: "Sound volume", ru: "Громкость звука" },
  speech: { en: "Text to speech", ru: "Озвучивание текста" },
  speechEnabled: { en: "Read donation messages", ru: "Озвучивать сообщения к донатам" },
  voice: { en: "Voice language", ru: "Язык голоса" },
  russianVoice: { en: "Russian", ru: "Русский" },
  speechVolume: { en: "Speech volume", ru: "Громкость речи" },
  save: { en: "Save settings", ru: "Сохранить настройки" },
  saved: { en: "Settings saved", ru: "Настройки сохранены" },
  requestFailed: {
    en: "The alert service did not respond. Try again.",
    ru: "Сервис алертов не ответил. Попробуйте снова.",
  },
  queue: { en: "Playback queue", ru: "Очередь воспроизведения" },
  pending: {
    en: ({ count }: { count: number }) => `${count} waiting`,
    ru: ({ count }: { count: number }) => `В очереди: ${count}`,
  },
  queueEmpty: { en: "No alert is playing", ru: "Сейчас алертов нет" },
  history: { en: "Recent playback", ru: "Недавние алерты" },
  historyEmpty: {
    en: "Played alerts will appear here.",
    ru: "Здесь появятся показанные алерты.",
  },
  replay: { en: "Replay", ru: "Повторить" },
  preparing: { en: "Preparing", ru: "Подготовка" },
  pendingState: { en: "Waiting", ru: "Ожидание" },
  playing: { en: "Playing", ru: "Показ" },
  completed: { en: "Completed", ru: "Показан" },
  skipped: { en: "Skipped", ru: "Пропущен" },
  expired: { en: "Expired", ru: "Просрочен" },
  interrupted: { en: "Interrupted", ru: "Прерван" },
  diagnostics: { en: "Diagnostics", ru: "Диагностика" },
  speechFallbackTitle: { en: "Speech fallback", ru: "Речь недоступна" },
  speechFallback: {
    en: "The alert continued without text to speech.",
    ru: "Алерт продолжился без озвучивания текста.",
  },
  imageFallbackTitle: { en: "Image fallback", ru: "Изображение недоступно" },
  imageFallback: {
    en: "The alert continued without its uploaded image.",
    ru: "Алерт продолжился без загруженного изображения.",
  },
  soundFallbackTitle: { en: "Sound fallback", ru: "Звук недоступен" },
  soundFallback: {
    en: "The alert continued without its uploaded sound.",
    ru: "Алерт продолжился без загруженного звука.",
  },
  audioBlockedTitle: { en: "Audio blocked", ru: "Аудио заблокировано" },
  audioBlocked: {
    en: "The browser blocked alert audio. Check the OBS Browser Source audio settings.",
    ru: "Браузер заблокировал аудио. Проверьте настройки звука Browser Source в OBS.",
  },
  expiredTitle: { en: "Alert expired", ru: "Алерт просрочен" },
  expiredDetail: {
    en: "The alert became too old to play and was removed from the queue.",
    ru: "Алерт устарел и был удалён из очереди до показа.",
  },
  backlogTitle: { en: "Backlog limited", ru: "Очередь ограничена" },
  backlogDetail: {
    en: "An old alert was removed because the playback backlog reached its limit.",
    ru: "Старый алерт удалён, потому что очередь достигла своего предела.",
  },
  playbackInterruptedTitle: { en: "Playback interrupted", ru: "Показ прерван" },
  playbackInterrupted: {
    en: "The active Browser Source stopped before the alert completed.",
    ru: "Активный Browser Source остановился до завершения алерта.",
  },
  playbackTimeoutTitle: { en: "Acknowledgement timed out", ru: "Нет подтверждения" },
  playbackTimeout: {
    en: "The player did not confirm completion, so StreamBrew released the queue.",
    ru: "Плеер не подтвердил завершение, поэтому StreamBrew освободил очередь.",
  },
  overlayRotatedTitle: { en: "OBS link rotated", ru: "Ссылка OBS обновлена" },
  overlayRotated: {
    en: "Playback stopped because the secret OBS link changed.",
    ru: "Показ остановлен после обновления секретной ссылки OBS.",
  },
  playbackIssueTitle: { en: "Playback issue", ru: "Проблема воспроизведения" },
  playbackIssue: {
    en: "The alert player recovered from a playback problem.",
    ru: "Плеер алертов восстановился после ошибки воспроизведения.",
  },
  lastHeartbeat: {
    en: ({ value }: { value: string }) => `Last widget heartbeat: ${value}`,
    ru: ({ value }: { value: string }) => `Последний сигнал виджета: ${value}`,
  },
  healthy: { en: "No recent problems", ru: "Недавних проблем нет" },
  loading: { en: "Loading alert controls…", ru: "Загружаем управление алертами…" },
});

export const Route = createFileRoute("/_authenticated/alerts")({
  component: AlertsPage,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("alerts")} · StreamBrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await preloadRouteQuery(
      context.queryClient,
      context.trpc.alerts.dashboard.queryOptions(),
    ).catch(() => undefined);
  },
});

const panelClass = "rounded-2xl border border-border bg-card p-4 sm:p-5";

function previewPlayback(settings: AlertSettings): AlertPlayback {
  return AlertPlaybackSchema.parse({
    playbackId: "64fb569a-95bb-4d1a-a6ad-765b0f2d5702",
    donationId: null,
    kind: "test",
    state: "playing",
    source: "donationalerts",
    author: "Cosmic Coffee",
    message: null,
    amount: "25.00",
    currency: "USD",
    imageAssetId: settings.imageAssetId,
    soundAssetId: settings.soundAssetId,
    ttsAssetId: null,
    displayDurationMs: settings.displayDurationMs,
    soundVolume: settings.soundVolume,
    ttsVolume: settings.ttsVolume,
    accentColor: settings.accentColor,
    createdAt: new Date(0),
    startedAt: new Date(0),
    finishedAt: null,
    detail: null,
  });
}

function AlertsPage() {
  const i18nContext = useI18n(i18n);
  const dashboardQuery = useAlertDashboard();
  const dashboard = dashboardQuery.data;

  if (dashboardQuery.isError && !dashboard) {
    return (
      <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <CosmicPageHeader title={i18nContext.t("alerts")} variant="signal" />
        <QueryErrorState
          className="min-h-0 grow"
          isRetrying={dashboardQuery.isFetching}
          onRetry={() => void dashboardQuery.refetch()}
        />
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <CosmicPageHeader title={i18nContext.t("alerts")} variant="signal" />
        <div
          aria-label={i18nContext.t("loading")}
          className="grid gap-3 overflow-hidden p-4"
          role="status"
        >
          <Skeleton className="h-72" />
          <div className="grid gap-3 lg:grid-cols-3">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <AlertsDashboard
      dashboard={dashboard}
      requestFailed={dashboardQuery.isError}
      {...i18nContext}
    />
  );
}

type Translator = ReturnType<typeof useI18n<typeof i18n>>["t"];
type SetSetting = <Key extends keyof AlertSettings>(key: Key, value: AlertSettings[Key]) => void;
type AlertDashboardData = NonNullable<ReturnType<typeof useAlertDashboard>["data"]>;
type AlertActions = ReturnType<typeof useAlertMutations>;
type AssetKind = Extract<AlertAssetKind, "image" | "sound">;

const uploadRules = {
  image: {
    maxBytes: 4 * 1024 * 1024,
    types: ["image/gif", "image/jpeg", "image/png", "image/webp"],
  },
  sound: {
    maxBytes: 10 * 1024 * 1024,
    types: ["audio/mpeg", "audio/ogg", "audio/opus", "audio/wav", "audio/wave", "audio/x-wav"],
  },
} satisfies Record<AssetKind, { maxBytes: number; types: string[] }>;

function AlertsDashboard({
  dashboard,
  locale,
  requestFailed,
  t,
}: {
  dashboard: AlertDashboardData;
  locale: "en" | "ru";
  requestFailed: boolean;
  t: Translator;
}) {
  const actions = useAlertMutations();
  const editor = useAlertEditor(dashboard, actions, t);
  const overlay = useOverlayAccess(actions, editor.setNotice, t);
  const [preview, setPreview] = useState<AlertPlayback | null>(null);
  if (!editor.draft) return <AlertsLoading t={t} />;
  const loadedEditor = { ...editor, draft: editor.draft };

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <AlertsHeader actions={actions} dashboard={dashboard} setNotice={editor.setNotice} t={t} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <NoticeBanner notice={editor.notice} requestFailed={requestFailed} t={t} />
        <PreviewAndOverlay
          dashboard={dashboard}
          draft={loadedEditor.draft}
          overlay={overlay}
          preview={preview}
          setPreview={setPreview}
          t={t}
        />
        <SettingsForm
          actions={actions}
          dashboard={dashboard}
          editor={loadedEditor}
          locale={locale}
          t={t}
        />
        <PlaybackPanels
          actions={actions}
          dashboard={dashboard}
          locale={locale}
          onError={() => editor.setNotice(t("requestFailed"))}
          t={t}
        />
        <DiagnosticsPanel dashboard={dashboard} locale={locale} t={t} />
      </div>
    </section>
  );
}

function AlertsLoading({ t }: { t: Translator }) {
  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader title={t("alerts")} variant="signal" />
      <div aria-label={t("loading")} className="grid gap-3 overflow-hidden p-4" role="status">
        <Skeleton className="h-72" />
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </section>
  );
}

function useAlertEditor(dashboard: AlertDashboardData, actions: AlertActions, t: Translator) {
  const [draft, setDraft] = useState<AlertSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState<AssetKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(dashboard.settings);
  }, [dashboard, dirty]);

  const setSetting: SetSetting = (key, value) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    setNotice(null);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !AlertSettingsSchema.safeParse(draft).success) return;
    actions.settings.mutate(draft, {
      onSuccess: () => {
        setDirty(false);
        setNotice(t("saved"));
      },
      onError: () => setNotice(t("requestFailed")),
    });
  };
  const upload = (kind: AssetKind, event: ChangeEvent<HTMLInputElement>) => {
    void uploadAlertAsset(kind, event, actions, setDraft, setUploading, setNotice, t);
  };
  return { dirty, draft, notice, save, setDraft, setNotice, setSetting, upload, uploading };
}

async function uploadAlertAsset(
  kind: AssetKind,
  event: ChangeEvent<HTMLInputElement>,
  actions: AlertActions,
  setDraft: Dispatch<SetStateAction<AlertSettings | null>>,
  setUploading: Dispatch<SetStateAction<AssetKind | null>>,
  setNotice: Dispatch<SetStateAction<string | null>>,
  t: Translator,
) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  const rule = uploadRules[kind];
  if (file.size === 0 || file.size > rule.maxBytes || !rule.types.includes(file.type)) {
    setNotice(t("unsupportedFile"));
    return;
  }
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", file);
  setUploading(kind);
  setNotice(null);
  try {
    const response = await fetch("/api/alerts/upload", {
      method: "POST",
      headers: { "X-StreamBrew-Upload": "1" },
      body: form,
    });
    const asset = AlertAssetSchema.safeParse(await response.json());
    if (!response.ok || !asset.success) throw new Error("Upload failed");
    const assetKey = kind === "image" ? "imageAssetId" : "soundAssetId";
    setDraft((current) => (current ? { ...current, [assetKey]: asset.data.assetId } : current));
    setNotice(t("uploaded"));
    await actions.refresh();
  } catch {
    setNotice(t("uploadFailed"));
  } finally {
    setUploading(null);
  }
}

function useOverlayAccess(
  actions: AlertActions,
  setNotice: (notice: string) => void,
  t: Translator,
) {
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rotate = () => {
    actions.rotateToken.mutate(undefined, {
      onSuccess: ({ overlayUrl: nextUrl }) => {
        setOverlayUrl(nextUrl);
        setCopied(false);
      },
      onError: () => setNotice(t("requestFailed")),
    });
  };
  const copy = async () => {
    if (!overlayUrl) return;
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setNotice(t("requestFailed"));
    }
  };
  return { copied, copy, overlayUrl, rotate, rotatePending: actions.rotateToken.isPending };
}

type AlertEditor = ReturnType<typeof useAlertEditor>;
type OverlayAccess = ReturnType<typeof useOverlayAccess>;

function playerStatus(dashboard: AlertDashboardData, t: Translator) {
  if (!dashboard.activePlayer) return { detail: t("noSource"), state: "offline" as const };
  const detail =
    dashboard.activePlayer.active && dashboard.activePlayer.visible
      ? t("activeSource")
      : t("hiddenSource");
  const state: "connected" | "standby" =
    dashboard.activePlayer.state === "standby" ? "standby" : "connected";
  return { detail, state };
}

function PlayerStatus({ dashboard, t }: { dashboard: AlertDashboardData; t: Translator }) {
  const status = playerStatus(dashboard, t);
  const statusClass = {
    connected: "border-emerald-300/35 bg-emerald-400/12 text-emerald-100",
    offline: "border-white/15 bg-white/8 text-white/75",
    standby: "border-amber-300/35 bg-amber-400/12 text-amber-100",
  }[status.state];
  const dotClass = {
    connected: "bg-emerald-400",
    offline: "bg-white/35",
    standby: "bg-amber-400",
  }[status.state];
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-semibold",
        statusClass,
      )}
      title={status.detail}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", dotClass)} />
      {t(status.state)}
    </span>
  );
}

function AlertsHeader({
  actions,
  dashboard,
  setNotice,
  t,
}: {
  actions: AlertActions;
  dashboard: AlertDashboardData;
  setNotice: (notice: string) => void;
  t: Translator;
}) {
  const onError = () => setNotice(t("requestFailed"));
  return (
    <CosmicPageHeader
      title={t("alerts")}
      variant="signal"
      actions={
        <>
          <PlayerStatus dashboard={dashboard} t={t} />
          <Button
            disabled={actions.paused.isPending}
            onClick={() =>
              actions.paused.mutate({ paused: !dashboard.settings.paused }, { onError })
            }
            size="sm"
            type="button"
            variant="secondary"
          >
            {dashboard.settings.paused ? (
              <Icons.play aria-hidden="true" />
            ) : (
              <Icons.pause aria-hidden="true" />
            )}
            {t(dashboard.settings.paused ? "resume" : "pause")}
          </Button>
          <Button
            disabled={actions.test.isPending || !dashboard.hasOverlayToken}
            onClick={() => actions.test.mutate(undefined, { onError })}
            size="sm"
            type="button"
          >
            {actions.test.isPending ? (
              <Icons.loader aria-hidden="true" className="animate-spin" />
            ) : (
              <Icons.testAlert aria-hidden="true" />
            )}
            {t("testInObs")}
          </Button>
        </>
      }
    />
  );
}

function NoticeBanner({
  notice,
  requestFailed,
  t,
}: {
  notice: string | null;
  requestFailed: boolean;
  t: Translator;
}) {
  if (!notice && !requestFailed) return null;
  const failed = requestFailed || notice === t("requestFailed") || notice === t("uploadFailed");
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3 text-sm",
        failed
          ? "border-destructive/30 bg-destructive/8 text-destructive"
          : "border-emerald-300/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
      )}
      role="status"
    >
      {notice ?? t("requestFailed")}
    </div>
  );
}

function PreviewAndOverlay({
  dashboard,
  draft,
  overlay,
  preview,
  setPreview,
  t,
}: {
  dashboard: AlertDashboardData;
  draft: AlertSettings;
  overlay: OverlayAccess;
  preview: AlertPlayback | null;
  setPreview: Dispatch<SetStateAction<AlertPlayback | null>>;
  t: Translator;
}) {
  const parsedDraft = AlertSettingsSchema.safeParse(draft);
  const settings = parsedDraft.success
    ? parsedDraft.data
    : { ...draft, accentColor: dashboard.settings.accentColor };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
      <PreviewPanel
        preview={preview}
        sample={previewPlayback(settings)}
        setPreview={setPreview}
        t={t}
      />
      <OverlayPanel hasToken={dashboard.hasOverlayToken} overlay={overlay} t={t} />
    </div>
  );
}

function PreviewPanel({
  preview,
  sample,
  setPreview,
  t,
}: {
  preview: AlertPlayback | null;
  sample: AlertPlayback;
  setPreview: Dispatch<SetStateAction<AlertPlayback | null>>;
  t: Translator;
}) {
  const play = () =>
    setPreview(AlertPlaybackSchema.parse({ ...sample, playbackId: crypto.randomUUID() }));
  return (
    <article className={cn(panelClass, "flex min-w-0 flex-col gap-3")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{t("preview")}</h2>
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            {t("previewDescription")}
          </p>
        </div>
        <span className="rounded-lg bg-secondary px-2 py-1 text-[10px] font-bold text-secondary-foreground">
          4:3
        </span>
      </div>
      <div className="cosmic-grid relative aspect-4/3 min-h-0 overflow-hidden rounded-xl border border-white/10 bg-[#171019]">
        <AlertPlayer onFinished={() => setPreview(null)} playback={preview} />
        {!preview && (
          <Button
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            onClick={play}
            type="button"
            variant="secondary"
          >
            <Icons.play aria-hidden="true" /> {t("playPreview")}
          </Button>
        )}
      </div>
    </article>
  );
}

function OverlayPanel({
  hasToken,
  overlay,
  t,
}: {
  hasToken: boolean;
  overlay: OverlayAccess;
  t: Translator;
}) {
  return (
    <article className={cn(panelClass, "flex flex-col gap-4")}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icons.monitor aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold">{t("obsLink")}</h2>
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            {t("obsLinkDescription")}
          </p>
        </div>
      </div>
      {overlay.overlayUrl ? (
        <>
          <Input aria-label={t("obsLink")} readOnly value={overlay.overlayUrl} />
          <p className="text-xs text-amber-700 dark:text-amber-300">{t("linkCreated")}</p>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
          {t(hasToken ? "hiddenLink" : "missingLink")}
        </div>
      )}
      <OverlayButtons hasToken={hasToken} overlay={overlay} t={t} />
      <a
        className="inline-flex items-center gap-1.5 self-start rounded text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        href="https://obsproject.com/kb/browser-source"
        rel="noreferrer"
        target="_blank"
      >
        {t("openObsGuide")} <Icons.externalLink aria-hidden="true" className="size-3.5" />
      </a>
    </article>
  );
}

function OverlayButtons({
  hasToken,
  overlay,
  t,
}: {
  hasToken: boolean;
  overlay: OverlayAccess;
  t: Translator;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={overlay.rotatePending} onClick={overlay.rotate} type="button">
        {overlay.rotatePending ? (
          <Icons.loader aria-hidden="true" className="animate-spin" />
        ) : (
          <Icons.rotateToken aria-hidden="true" />
        )}
        {t(hasToken ? "rotateLink" : "createLink")}
      </Button>
      {overlay.overlayUrl && (
        <Button onClick={() => void overlay.copy()} type="button" variant="outline">
          {overlay.copied ? <Icons.copied aria-hidden="true" /> : <Icons.copy aria-hidden="true" />}
          {t(overlay.copied ? "copied" : "copy")}
        </Button>
      )}
    </div>
  );
}

function SettingsForm({
  actions,
  dashboard,
  editor,
  locale,
  t,
}: {
  actions: AlertActions;
  dashboard: AlertDashboardData;
  editor: AlertEditor & { draft: AlertSettings };
  locale: "en" | "ru";
  t: Translator;
}) {
  const valid = AlertSettingsSchema.safeParse(editor.draft).success;
  return (
    <form className="grid gap-4 xl:grid-cols-3" onSubmit={editor.save}>
      <PresentationSettings draft={editor.draft} setSetting={editor.setSetting} t={t} />
      <SourceSettings
        connectedSources={dashboard.connectedSources}
        draft={editor.draft}
        setSetting={editor.setSetting}
        t={t}
      />
      <SpeechSettings draft={editor.draft} setSetting={editor.setSetting} t={t} />
      <MediaSettings
        actions={actions}
        dashboard={dashboard}
        editor={editor}
        locale={locale}
        saveDisabled={!editor.dirty || actions.settings.isPending || !valid}
        t={t}
      />
    </form>
  );
}

function MediaSettings({
  actions,
  dashboard,
  editor,
  locale,
  saveDisabled,
  t,
}: {
  actions: AlertActions;
  dashboard: AlertDashboardData;
  editor: AlertEditor & { draft: AlertSettings };
  locale: "en" | "ru";
  saveDisabled: boolean;
  t: Translator;
}) {
  const remove = (kind: AssetKind) => {
    const asset = kind === "image" ? dashboard.imageAsset : dashboard.soundAsset;
    if (!asset) return;
    actions.deleteAsset.mutate(
      { assetId: asset.assetId },
      {
        onSuccess: () =>
          editor.setDraft((current) => current && { ...current, [`${kind}AssetId`]: null }),
        onError: () => editor.setNotice(t("requestFailed")),
      },
    );
  };
  return (
    <article className={cn(panelClass, "flex flex-col gap-4 xl:col-span-3")}>
      <MediaHeader actions={actions} disabled={saveDisabled} t={t} />
      <div className="grid gap-3 md:grid-cols-2">
        <AlertAssetControl kind="image" onRemove={remove} {...{ dashboard, editor, locale, t }} />
        <AlertAssetControl kind="sound" onRemove={remove} {...{ dashboard, editor, locale, t }} />
      </div>
      <VolumeField
        id="sound-volume"
        label={t("soundVolume")}
        onChange={(value) => editor.setSetting("soundVolume", value)}
        value={editor.draft.soundVolume}
      />
    </article>
  );
}

function AlertAssetControl({
  dashboard,
  editor,
  kind,
  locale,
  onRemove,
  t,
}: {
  dashboard: AlertDashboardData;
  editor: AlertEditor;
  kind: AssetKind;
  locale: "en" | "ru";
  onRemove: (kind: AssetKind) => void;
  t: Translator;
}) {
  const image = kind === "image";
  return (
    <AssetControl
      accept={
        image
          ? "image/gif,image/jpeg,image/png,image/webp"
          : "audio/mpeg,audio/ogg,audio/opus,audio/wav,audio/wave,audio/x-wav"
      }
      asset={image ? dashboard.imageAsset : dashboard.soundAsset}
      description={t(image ? "imageLimits" : "soundLimits")}
      icon={image ? <Icons.image aria-hidden="true" /> : <Icons.audio aria-hidden="true" />}
      kind={kind}
      label={t(image ? "image" : "sound")}
      locale={locale}
      onRemove={() => onRemove(kind)}
      onUpload={(event) => editor.upload(kind, event)}
      pending={editor.uploading === kind}
      t={t}
    />
  );
}

function MediaHeader({
  actions,
  disabled,
  t,
}: {
  actions: AlertActions;
  disabled: boolean;
  t: Translator;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-heading text-lg font-semibold">{t("media")}</h2>
      <Button disabled={disabled} type="submit">
        {actions.settings.isPending ? (
          <Icons.loader aria-hidden="true" className="animate-spin" />
        ) : (
          <Icons.save aria-hidden="true" />
        )}
        {t("save")}
      </Button>
    </div>
  );
}

function DiagnosticsPanel({
  dashboard,
  locale,
  t,
}: {
  dashboard: AlertDashboardData;
  locale: "en" | "ru";
  t: Translator;
}) {
  return (
    <article className={cn(panelClass, "flex flex-col gap-3")}>
      <div className="flex items-center gap-2">
        <Icons.warn aria-hidden="true" className="text-primary" />
        <h2 className="font-heading text-lg font-semibold">{t("diagnostics")}</h2>
      </div>
      {dashboard.activePlayer && (
        <LastHeartbeat locale={locale} t={t} value={dashboard.activePlayer.lastHeartbeatAt} />
      )}
      {dashboard.diagnostics.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("healthy")}</p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {dashboard.diagnostics.map((diagnostic, index) => (
            <DiagnosticRow
              diagnostic={diagnostic}
              key={`${diagnostic.code}-${diagnostic.occurredAt.toISOString()}-${index}`}
              locale={locale}
              t={t}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function DiagnosticRow({
  diagnostic,
  locale,
  t,
}: {
  diagnostic: AlertDashboardData["diagnostics"][number];
  locale: "en" | "ru";
  t: Translator;
}) {
  const copy = diagnosticCopy(diagnostic.code, t);
  const levelClass =
    diagnostic.level === "error"
      ? "border-destructive/30 bg-destructive/8"
      : diagnostic.level === "warning"
        ? "border-amber-300/40 bg-amber-400/8"
        : "border-border bg-muted/25";
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 text-sm", levelClass)}>
      <div className="flex items-center justify-between gap-3">
        <strong>{copy.title}</strong>
        <LocalTime
          className="text-xs text-muted-foreground"
          locale={locale}
          value={diagnostic.occurredAt}
        />
      </div>
      <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{copy.detail}</p>
    </div>
  );
}

function diagnosticCopy(code: AlertDiagnosticCode, t: Translator) {
  switch (code) {
    case "tts_unavailable":
      return { title: t("speechFallbackTitle"), detail: t("speechFallback") };
    case "image_unavailable":
      return { title: t("imageFallbackTitle"), detail: t("imageFallback") };
    case "sound_unavailable":
      return { title: t("soundFallbackTitle"), detail: t("soundFallback") };
    case "audio_blocked":
      return { title: t("audioBlockedTitle"), detail: t("audioBlocked") };
    case "alert_expired":
      return { title: t("expiredTitle"), detail: t("expiredDetail") };
    case "backlog_limit":
      return { title: t("backlogTitle"), detail: t("backlogDetail") };
    case "overlay_rotated":
      return { title: t("overlayRotatedTitle"), detail: t("overlayRotated") };
    case "playback_timeout":
      return { title: t("playbackTimeoutTitle"), detail: t("playbackTimeout") };
    case "player_disconnected":
      return {
        title: t("playbackInterruptedTitle"),
        detail: t("playbackInterrupted"),
      };
    case "playback_issue":
      return { title: t("playbackIssueTitle"), detail: t("playbackIssue") };
  }
}

function PresentationSettings({
  draft,
  setSetting,
  t,
}: {
  draft: AlertSettings;
  setSetting: SetSetting;
  t: Translator;
}) {
  return (
    <article className={cn(panelClass, "flex flex-col gap-5")}>
      <div>
        <h2 className="font-heading text-lg font-semibold">{t("settings")}</h2>
        <p className="pt-1 text-xs text-muted-foreground">{t("alertsEnabledDescription")}</p>
      </div>
      <Field orientation="horizontal" className="justify-between gap-4">
        <FieldLabel htmlFor="alerts-enabled">{t("alertsEnabled")}</FieldLabel>
        <Switch
          checked={draft.enabled}
          id="alerts-enabled"
          onCheckedChange={(checked) => setSetting("enabled", checked)}
        />
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="alert-duration">{t("duration")}</FieldLabel>
          <output className="text-xs font-semibold text-primary">
            {t("seconds", { value: draft.displayDurationMs / 1000 })}
          </output>
        </div>
        <input
          className="alert-range"
          id="alert-duration"
          max={30}
          min={1}
          onChange={(event) =>
            setSetting("displayDurationMs", Number(event.currentTarget.value) * 1000)
          }
          step={1}
          type="range"
          value={draft.displayDurationMs / 1000}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="alert-accent">{t("accent")}</FieldLabel>
        <div className="flex gap-2">
          <input
            aria-label={t("accent")}
            className="size-8 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1"
            id="alert-accent"
            onChange={(event) => setSetting("accentColor", event.currentTarget.value)}
            type="color"
            value={draft.accentColor}
          />
          <Input
            aria-label={t("accent")}
            maxLength={7}
            onChange={(event) => setSetting("accentColor", event.currentTarget.value)}
            value={draft.accentColor}
          />
        </div>
      </Field>
    </article>
  );
}

function SourceSettings({
  connectedSources,
  draft,
  setSetting,
  t,
}: {
  connectedSources: DonationSource[];
  draft: AlertSettings;
  setSetting: SetSetting;
  t: Translator;
}) {
  return (
    <article className={cn(panelClass, "flex flex-col gap-4")}>
      <div>
        <h2 className="font-heading text-lg font-semibold">{t("sources")}</h2>
        <p className="pt-1 text-xs text-muted-foreground">{t("sourcesDescription")}</p>
      </div>
      <div className="flex flex-col gap-2">
        {DonationSourceSchema.options.map((source) => {
          const connected = connectedSources.includes(source);
          const checked = draft.enabledSources.includes(source);
          return (
            <div
              className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-2.5"
              key={source}
            >
              <DonationSourceMark source={source} />
              <div className="min-w-0 grow">
                <strong className="block truncate text-sm">
                  {donationSourceDetails(source).name}
                </strong>
                <DonationSourceConnectionStatus connected={connected} />
              </div>
              <Switch
                aria-label={donationSourceDetails(source).name}
                checked={checked}
                onCheckedChange={(enabled) =>
                  setSetting(
                    "enabledSources",
                    enabled
                      ? [...draft.enabledSources, source]
                      : draft.enabledSources.filter((item) => item !== source),
                  )
                }
                size="sm"
              />
            </div>
          );
        })}
      </div>
    </article>
  );
}

function SpeechSettings({
  draft,
  setSetting,
  t,
}: {
  draft: AlertSettings;
  setSetting: SetSetting;
  t: Translator;
}) {
  return (
    <article className={cn(panelClass, "flex flex-col gap-5")}>
      <h2 className="font-heading text-lg font-semibold">{t("speech")}</h2>
      <Field orientation="horizontal" className="justify-between gap-4">
        <FieldLabel htmlFor="tts-enabled">{t("speechEnabled")}</FieldLabel>
        <Switch
          checked={draft.ttsEnabled}
          id="tts-enabled"
          onCheckedChange={(checked) => setSetting("ttsEnabled", checked)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="tts-voice">{t("voice")}</FieldLabel>
        <select
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          disabled={!draft.ttsEnabled}
          id="tts-voice"
          onChange={(event) => setSetting("ttsVoice", event.currentTarget.value)}
          value={draft.ttsVoice}
        >
          <option value="ru">{t("russianVoice")}</option>
        </select>
      </Field>
      <VolumeField
        disabled={!draft.ttsEnabled}
        id="tts-volume"
        label={t("speechVolume")}
        onChange={(value) => setSetting("ttsVolume", value)}
        value={draft.ttsVolume}
      />
    </article>
  );
}

function VolumeField({
  disabled,
  id,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <output className="text-xs font-semibold text-primary">{value}%</output>
      </div>
      <input
        className="alert-range"
        disabled={disabled}
        id={id}
        max={100}
        min={0}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={1}
        type="range"
        value={value}
      />
    </Field>
  );
}

function AssetControl({
  accept,
  asset,
  description,
  icon,
  kind,
  label,
  locale,
  onRemove,
  onUpload,
  pending,
  t,
}: {
  accept: string;
  asset: { assetId: string; sizeBytes: number } | null;
  description: string;
  icon: ReactNode;
  kind: Extract<AlertAssetKind, "image" | "sound">;
  label: string;
  locale: "en" | "ru";
  onRemove: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  pending: boolean;
  t: Translator;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formattedSize = asset
    ? new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }).format(asset.sizeBytes / 1024 / 1024)
    : null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0 grow">
        <strong className="block text-sm">{label}</strong>
        <FieldDescription>
          {formattedSize ? t("assetSize", { value: formattedSize }) : description}
        </FieldDescription>
      </div>
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {pending ? (
          <Icons.loader aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Icons.upload aria-hidden="true" className="size-4" />
        )}
        {t(asset ? "replace" : "upload")}
      </Button>
      <input
        accept={accept}
        className="sr-only"
        disabled={pending}
        name={`${kind}-upload`}
        onChange={onUpload}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      {asset && (
        <Button
          aria-label={t("remove")}
          onClick={onRemove}
          size="icon-sm"
          type="button"
          variant="destructive"
        >
          <Icons.removeSource aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

const stateKey = {
  preparing: "preparing",
  pending: "pendingState",
  playing: "playing",
  completed: "completed",
  skipped: "skipped",
  expired: "expired",
  interrupted: "interrupted",
} as const;

function canReplayAlert(playback: AlertPlayback) {
  if (playback.donationId === null) return false;
  switch (playback.state) {
    case "completed":
    case "skipped":
    case "expired":
    case "interrupted":
      return true;
    default:
      return false;
  }
}

function PlaybackPanels({
  dashboard,
  locale,
  actions,
  onError,
  t,
}: {
  dashboard: NonNullable<ReturnType<typeof useAlertDashboard>["data"]>;
  locale: "en" | "ru";
  actions: ReturnType<typeof useAlertMutations>;
  onError: () => void;
  t: Translator;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <article className={cn(panelClass, "flex min-w-0 flex-col gap-4")}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icons.activity aria-hidden="true" className="text-primary" />
            <h2 className="font-heading text-lg font-semibold">{t("queue")}</h2>
          </div>
          <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-semibold">
            {t("pending", { count: dashboard.pendingCount })}
          </span>
        </div>
        {dashboard.currentPlayback ? (
          <PlaybackRow playback={dashboard.currentPlayback} locale={locale} t={t} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("queueEmpty")}
          </p>
        )}
        <Button
          className="self-start"
          disabled={
            (!dashboard.currentPlayback && dashboard.pendingCount === 0) || actions.skip.isPending
          }
          onClick={() => actions.skip.mutate(undefined, { onError })}
          type="button"
          variant="outline"
        >
          <Icons.skip aria-hidden="true" /> {t("skip")}
        </Button>
      </article>

      <article className={cn(panelClass, "flex min-w-0 flex-col gap-4")}>
        <div className="flex items-center gap-2">
          <Icons.history aria-hidden="true" className="text-primary" />
          <h2 className="font-heading text-lg font-semibold">{t("history")}</h2>
        </div>
        {dashboard.recentPlaybacks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {dashboard.recentPlaybacks.map((playback) => (
              <PlaybackRow
                action={
                  canReplayAlert(playback) ? (
                    <Button
                      aria-label={t("replay")}
                      disabled={actions.replay.isPending}
                      onClick={() =>
                        actions.replay.mutate({ playbackId: playback.playbackId }, { onError })
                      }
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Icons.retry aria-hidden="true" />
                    </Button>
                  ) : undefined
                }
                key={playback.playbackId}
                locale={locale}
                playback={playback}
                t={t}
              />
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

function PlaybackRow({
  action,
  locale,
  playback,
  t,
}: {
  action?: ReactNode;
  locale: "en" | "ru";
  playback: AlertPlayback;
  t: Translator;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: playback.accentColor }}
      />
      <div className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="truncate text-sm">{playback.author?.trim() || "—"}</strong>
          <span className="text-sm font-semibold text-primary">
            {fmtAmount(playback.amount, playback.currency, locale)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{t(stateKey[playback.state])}</span>
          <LocalTime locale={locale} value={playback.createdAt} />
        </div>
      </div>
      {action}
    </div>
  );
}

function LocalTime({
  className,
  locale,
  value,
}: {
  className?: string;
  locale: "en" | "ru";
  value: Date;
}) {
  const hydrated = useHydrated();
  return (
    <time className={className} dateTime={value.toISOString()}>
      {hydrated ? fmtListDate(value, locale) : "—"}
    </time>
  );
}

function LastHeartbeat({ locale, t, value }: { locale: "en" | "ru"; t: Translator; value: Date }) {
  const hydrated = useHydrated();
  return (
    <p className="text-xs text-muted-foreground">
      {t("lastHeartbeat", { value: hydrated ? fmtListDate(value, locale) : "—" })}
    </p>
  );
}
