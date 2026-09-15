import type {
  RestreamConfig,
  RestreamDestination,
  RestreamDestinationId,
  RestreamPlatform,
  RestreamSession,
} from "@streambrew/packages/restream.js";
import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Icons, PlatformIcons } from "@web/components/icons";
import QueryErrorState from "@web/components/query-error-state";
import { Button } from "@web/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@web/components/ui/field";
import { Input } from "@web/components/ui/input";
import { Switch } from "@web/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@web/components/ui/tooltip";
import { useRestreamConfigQ, useRestreamMutations } from "@web/hooks/restream";
import { preloadRouteQuery } from "@web/lib/trpc";
import { useState, type FormEvent } from "react";

import { createI18n, createTranslator, useI18n } from "../../lib/i18n";

const i18n = createI18n({
  multistream: { en: "Multistream", ru: "Мультистрим" },
  subtitle: {
    en: "Send one OBS stream to as many as three platforms.",
    ru: "Отправляйте один поток из OBS сразу на три площадки.",
  },
  source: { en: "OBS", ru: "OBS" },
  relay: { en: "StreamBrew relay", ru: "Ретранслятор StreamBrew" },
  destinations: { en: "Destinations", ru: "Площадки" },
  live: { en: "Live", ru: "В эфире" },
  connecting: { en: "Connecting", ru: "Подключаем" },
  ready: { en: "Ready for your stream", ru: "Готов к вашему эфиру" },
  readyDescription: {
    en: "Start streaming in OBS and the signal will fan out automatically.",
    ru: "Запустите трансляцию в OBS — сигнал разойдётся по площадкам автоматически.",
  },
  setupTitle: { en: "Connect OBS", ru: "Подключите OBS" },
  setupDescription: {
    en: "In OBS, choose Custom service and paste these two values.",
    ru: "В OBS выберите сервис «Настраиваемый» и вставьте эти два значения.",
  },
  server: { en: "Server", ru: "Сервер" },
  streamKey: { en: "Stream key", ru: "Ключ потока" },
  generateKey: { en: "Generate stream key", ru: "Создать ключ потока" },
  generating: { en: "Generating…", ru: "Создаём…" },
  rotateKey: { en: "Replace key", ru: "Заменить ключ" },
  confirmRotation: { en: "Replace and invalidate old key", ru: "Заменить и отключить старый" },
  rotationWarning: {
    en: "The old key will stop working. Update OBS before your next stream.",
    ru: "Старый ключ перестанет работать. Обновите OBS перед следующим эфиром.",
  },
  showKey: { en: "Show stream key", ru: "Показать ключ потока" },
  hideKey: { en: "Hide stream key", ru: "Скрыть ключ потока" },
  copy: { en: "Copy", ru: "Скопировать" },
  copied: { en: "Copied", ru: "Скопировано" },
  copyError: {
    en: "Could not copy. Select the value manually.",
    ru: "Не удалось скопировать. Выделите значение вручную.",
  },
  destinationHeading: { en: "Where the stream goes", ru: "Куда пойдёт эфир" },
  destinationDescription: {
    en: "Keys stay encrypted and are sent to the relay only while you are live.",
    ru: "Ключи хранятся в зашифрованном виде и передаются ретранслятору только во время эфира.",
  },
  addDestination: { en: "Add destination", ru: "Добавить площадку" },
  destinationLimit: {
    en: "All three destination slots are in use.",
    ru: "Все три места для площадок заняты.",
  },
  noDestinations: { en: "No destinations yet", ru: "Площадок пока нет" },
  noDestinationsDescription: {
    en: "Add Twitch, YouTube, KICK, or another RTMP endpoint to prepare your first multistream.",
    ru: "Добавьте Twitch, YouTube, KICK или другой RTMP‑адрес, чтобы подготовить первый мультистрим.",
  },
  disabled: { en: "Off", ru: "Выключено" },
  idle: { en: "Waiting", ru: "Ожидает" },
  forwarding: { en: "Receiving signal", ru: "Получает сигнал" },
  error: { en: "Connection error", ru: "Ошибка подключения" },
  sent: {
    en: ({ amount }: { amount: string }) => `${amount} sent`,
    ru: ({ amount }: { amount: string }) => `Передано ${amount}`,
  },
  enableDestination: { en: "Enable destination", ru: "Включить площадку" },
  disableDestination: { en: "Disable destination", ru: "Выключить площадку" },
  editDestination: { en: "Edit destination", ru: "Изменить площадку" },
  deleteDestination: { en: "Delete destination", ru: "Удалить площадку" },
  confirmDelete: { en: "Delete now", ru: "Удалить" },
  addFormTitle: { en: "Add a destination", ru: "Добавить площадку" },
  editFormTitle: { en: "Edit destination", ru: "Изменить площадку" },
  platform: { en: "Platform", ru: "Площадка" },
  label: { en: "Name", ru: "Название" },
  labelPlaceholder: { en: "Main channel", ru: "Основной канал" },
  serverUrl: { en: "RTMP server URL", ru: "RTMP‑адрес сервера" },
  serverPlaceholder: { en: "rtmps://server.example/live", ru: "rtmps://server.example/live" },
  destinationKey: { en: "Platform stream key", ru: "Ключ потока площадки" },
  keyPlaceholder: { en: "Paste the private key", ru: "Вставьте секретный ключ" },
  unchangedKey: {
    en: ({ hint }: { hint: string }) => `Leave blank to keep the key ending in ${hint}`,
    ru: ({ hint }: { hint: string }) => `Оставьте пустым, чтобы сохранить ключ на ${hint}`,
  },
  platformHelp: {
    en: "Where to find the server URL and stream key",
    ru: "Где найти RTMP‑адрес и ключ",
  },
  save: { en: "Save destination", ru: "Сохранить площадку" },
  saving: { en: "Saving…", ru: "Сохраняем…" },
  cancel: { en: "Cancel", ru: "Отмена" },
  saveError: {
    en: "The destination could not be saved. Check the RTMP address and try again.",
    ru: "Не удалось сохранить площадку. Проверьте RTMP‑адрес и попробуйте ещё раз.",
  },
  mutationError: {
    en: "The change could not be saved. Try again.",
    ru: "Не удалось сохранить изменение. Попробуйте ещё раз.",
  },
  betaPlan: { en: "Beta plan", ru: "Бета‑тариф" },
  monthlyPrice: {
    en: ({ amount }: { amount: string }) => `${amount} / month`,
    ru: ({ amount }: { amount: string }) => `${amount} / месяц`,
  },
  planIncludes: {
    en: ({ count }: { count: number }) =>
      `One input stream · Up to ${count} destinations · No transcoding`,
    ru: ({ count }: { count: number }) =>
      `Один входящий поток · До ${count} площадок · Без перекодирования`,
  },
  paymentSoon: { en: "Payment coming later", ru: "Оплата появится позже" },
  betaAccess: {
    en: "Beta access is active. You will not be charged while payment is unavailable.",
    ru: "Бета‑доступ активен. Пока оплата не подключена, списаний не будет.",
  },
  compatibility: { en: "Stream compatibility", ru: "Совместимость потока" },
  compatibilityDescription: {
    en: "Use H.264 video and AAC audio in OBS. StreamBrew forwards the original signal without changing it.",
    ru: "Используйте H.264 для видео и AAC для звука в OBS. StreamBrew передаёт исходный сигнал без изменений.",
  },
  twitch: { en: "Twitch", ru: "Twitch" },
  youtube: { en: "YouTube", ru: "YouTube" },
  kick: { en: "KICK", ru: "KICK" },
  custom: { en: "Other RTMP", ru: "Другой RTMP" },
});

const platformHelpUrls: Partial<Record<RestreamPlatform, string>> = {
  youtube: "https://support.google.com/youtube/answer/2907883",
  twitch: "https://help.twitch.tv/s/article/twitch-stream-key-faq",
  kick: "https://help.kick.com/en/articles/7066931-how-to-stream-on-kick-com",
};

type DestinationDraft = {
  destinationId?: RestreamDestinationId;
  platform: RestreamPlatform;
  label: string;
  serverUrl: string;
  streamKey: string;
  streamKeyHint?: string;
};

const emptyDraft: DestinationDraft = {
  platform: "youtube",
  label: "",
  serverUrl: "",
  streamKey: "",
};

export const Route = createFileRoute("/_authenticated/multistream")({
  component: MultistreamPage,
  head: ({ match }) => ({
    meta: [
      { title: `${createTranslator(match.context.locale, i18n)("multistream")} · StreamBrew` },
    ],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await preloadRouteQuery(context.queryClient, context.trpc.restream.config.queryOptions());
  },
});

function PlatformMark({ platform }: { platform: RestreamPlatform }) {
  if (platform === "custom") {
    return (
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
        <Icons.platform aria-hidden="true" className="size-[18px]" />
      </span>
    );
  }
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary/70">
      <img alt="" className="size-5" src={PlatformIcons[platform]} />
    </span>
  );
}

function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }) {
  const { t } = useI18n(i18n);
  const copied = label === t("copied");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} onClick={onCopy} size="icon-xs" type="button" variant="ghost">
            {copied ? <Icons.copied aria-hidden="true" /> : <Icons.copy aria-hidden="true" />}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SignalRail({ destinationCount, status }: { destinationCount: number; status?: string }) {
  const { t } = useI18n(i18n);
  const isLive = status === "live";
  const isConnecting = status === "connecting";
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#2d2229] px-4 py-4 text-[#fff8ed] shadow-[0_12px_32px_-24px_rgba(37,24,32,0.85)] sm:px-5">
      <div className="relative z-10 grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#fff8ed]/10 text-[#edbf88]">
            <Icons.monitor aria-hidden="true" className="size-4" />
          </span>
          <span className="hidden text-xs font-medium sm:inline">{t("source")}</span>
        </div>
        <div className="relative h-px bg-[#fff8ed]/20">
          {(isLive || isConnecting) && (
            <span className="absolute top-1/2 size-2 -translate-y-1/2 animate-[pulse_1.4s_ease-out_infinite] rounded-full bg-[#54cfa5] shadow-[0_0_14px_rgba(84,207,165,0.7)] motion-reduce:animate-none" />
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-center">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#edbf88] text-[#2d2229]">
            <Icons.multistream aria-hidden="true" className="size-[18px]" />
          </span>
          <span className="hidden text-xs font-semibold lg:inline">{t("relay")}</span>
        </div>
        <div className="relative h-px bg-[#fff8ed]/20">
          {isLive && (
            <span className="absolute top-1/2 right-0 size-2 -translate-y-1/2 animate-[pulse_1.4s_ease-out_infinite] rounded-full bg-[#54cfa5] shadow-[0_0_14px_rgba(84,207,165,0.7)] motion-reduce:animate-none" />
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#fff8ed]/10 text-[#edbf88]">
            <span className="text-xs font-bold tabular-nums">{destinationCount}</span>
          </span>
          <span className="hidden text-xs font-medium sm:inline">{t("destinations")}</span>
        </div>
      </div>
      <div className="relative z-10 flex gap-2 pt-3 text-xs text-[#fff8ed]/75" aria-live="polite">
        <span
          className={`mt-1 size-2 shrink-0 rounded-full ${isLive ? "bg-[#54cfa5]" : isConnecting ? "bg-[#ffbd3e]" : "bg-[#fff8ed]/35"}`}
        />
        <span>
          <strong className="font-semibold text-[#fff8ed]">
            {t(isLive ? "live" : isConnecting ? "connecting" : "ready")}
          </strong>
          {!isLive && !isConnecting && ` · ${t("readyDescription")}`}
        </span>
      </div>
      <span className="pointer-events-none absolute -right-8 -bottom-16 size-44 rounded-full border border-[#edbf88]/10" />
      <span className="pointer-events-none absolute -right-2 -bottom-10 size-28 rounded-full border border-[#edbf88]/10" />
    </div>
  );
}

function IngestSetup({
  ingest,
  isLive,
}: {
  ingest: { serverUrl: string; streamKey: string } | null;
  isLive: boolean;
}) {
  const { t } = useI18n(i18n);
  const { rotateIngestKey } = useRestreamMutations();
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<"server" | "key" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [confirmRotation, setConfirmRotation] = useState(false);
  const copy = async (value: string, target: "server" | "key") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      setCopyFailed(false);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold tracking-tight">{t("setupTitle")}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("setupDescription")}</p>
        </div>
        {ingest && !isLive && (
          <Button
            disabled={rotateIngestKey.isPending}
            onClick={() => {
              if (!confirmRotation) {
                setConfirmRotation(true);
                return;
              }
              rotateIngestKey.mutate(undefined, { onSuccess: () => setConfirmRotation(false) });
            }}
            size="sm"
            type="button"
            variant={confirmRotation ? "destructive" : "outline"}
          >
            {rotateIngestKey.isPending ? (
              <Icons.loader aria-hidden="true" className="animate-spin" />
            ) : (
              <Icons.rotateToken aria-hidden="true" />
            )}
            {t(confirmRotation ? "confirmRotation" : "rotateKey")}
          </Button>
        )}
      </div>
      {confirmRotation && <p className="text-xs text-destructive">{t("rotationWarning")}</p>}
      {copyFailed && (
        <p className="text-xs text-destructive" role="alert">
          {t("copyError")}
        </p>
      )}
      {ingest ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field>
            <FieldLabel>{t("server")}</FieldLabel>
            <div className="flex items-center rounded-xl border border-input bg-muted/45 px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
              <input
                className="h-10 min-w-0 grow bg-transparent px-1 font-mono text-xs outline-none sm:text-sm"
                readOnly
                value={ingest.serverUrl}
              />
              <CopyButton
                label={t(copied === "server" ? "copied" : "copy")}
                onCopy={() => void copy(ingest.serverUrl, "server")}
              />
            </div>
          </Field>
          <Field>
            <FieldLabel>{t("streamKey")}</FieldLabel>
            <div className="flex items-center rounded-xl border border-input bg-muted/45 px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
              <input
                aria-label={t("streamKey")}
                className="h-10 min-w-0 grow bg-transparent px-1 font-mono text-xs outline-none sm:text-sm"
                readOnly
                type={showKey ? "text" : "password"}
                value={ingest.streamKey}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={t(showKey ? "hideKey" : "showKey")}
                      onClick={() => setShowKey((visible) => !visible)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      {showKey ? (
                        <Icons.hideKey aria-hidden="true" />
                      ) : (
                        <Icons.showKey aria-hidden="true" />
                      )}
                    </Button>
                  }
                />
                <TooltipContent>{t(showKey ? "hideKey" : "showKey")}</TooltipContent>
              </Tooltip>
              <CopyButton
                label={t(copied === "key" ? "copied" : "copy")}
                onCopy={() => void copy(ingest.streamKey, "key")}
              />
            </div>
          </Field>
        </div>
      ) : (
        <Button
          className="self-start"
          disabled={rotateIngestKey.isPending}
          onClick={() => rotateIngestKey.mutate()}
          type="button"
        >
          {rotateIngestKey.isPending ? (
            <Icons.loader aria-hidden="true" className="animate-spin" />
          ) : (
            <Icons.multistream aria-hidden="true" />
          )}
          {t(rotateIngestKey.isPending ? "generating" : "generateKey")}
        </Button>
      )}
      {rotateIngestKey.isError && (
        <p className="text-xs text-destructive" role="alert">
          {t("mutationError")}
        </p>
      )}
    </section>
  );
}

function formatBytes(bytes: number, locale: string) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  const value = bytes / 1024 ** (unitIndex + 1);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}

function DestinationRow({
  destination,
  isLive,
  liveState,
  mutationBusy,
  mutationError,
  onDelete,
  onEdit,
  onToggle,
}: {
  destination: RestreamDestination;
  isLive: boolean;
  liveState?: RestreamSession["destinations"][number];
  mutationBusy: boolean;
  mutationError: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { locale, t } = useI18n(i18n);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const state = !destination.enabled ? "disabled" : (liveState?.state ?? "idle");
  const stateColor =
    state === "forwarding"
      ? "bg-emerald-500"
      : state === "error"
        ? "bg-destructive"
        : state === "disabled"
          ? "bg-muted-foreground/35"
          : "bg-amber-400";

  return (
    <article className="grid min-w-0 gap-3 border-t border-border/75 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <PlatformMark platform={destination.platform} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate text-sm font-semibold">{destination.label}</h3>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-1.5 rounded-full ${stateColor}`} />
              {t(state)}
            </span>
          </div>
          <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground sm:text-xs">
            {destination.serverUrl} · ••••{destination.streamKeyHint}
          </p>
          {liveState && liveState.outboundBytes > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("sent", { amount: formatBytes(liveState.outboundBytes, locale) })}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Switch
          aria-label={t(destination.enabled ? "disableDestination" : "enableDestination")}
          checked={destination.enabled}
          disabled={mutationBusy || isLive}
          onCheckedChange={onToggle}
          size="sm"
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={t("editDestination")}
                disabled={mutationBusy || isLive}
                onClick={onEdit}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Icons.edit aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>{t("editDestination")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={t(confirmDelete ? "confirmDelete" : "deleteDestination")}
                disabled={mutationBusy || isLive}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    return;
                  }
                  onDelete();
                }}
                size={confirmDelete ? "sm" : "icon-sm"}
                type="button"
                variant={confirmDelete ? "destructive" : "ghost"}
              >
                <Icons.removeSource aria-hidden="true" />
                {confirmDelete && t("confirmDelete")}
              </Button>
            }
          />
          <TooltipContent>{t("deleteDestination")}</TooltipContent>
        </Tooltip>
      </div>
      {mutationError && (
        <p className="text-xs text-destructive sm:col-span-2" role="alert">
          {t("mutationError")}
        </p>
      )}
    </article>
  );
}

function DestinationForm({ draft, onClose }: { draft: DestinationDraft; onClose: () => void }) {
  const { t } = useI18n(i18n);
  const { createDestination, updateDestination } = useRestreamMutations();
  const [value, setValue] = useState(draft);
  const mutation = value.destinationId === undefined ? createDestination : updateDestination;
  const helpUrl = platformHelpUrls[value.platform];
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      if (value.destinationId === undefined) {
        await createDestination.mutateAsync({
          platform: value.platform,
          label: value.label,
          serverUrl: value.serverUrl,
          streamKey: value.streamKey,
        });
      } else {
        await updateDestination.mutateAsync({
          destinationId: value.destinationId,
          platform: value.platform,
          label: value.label,
          serverUrl: value.serverUrl,
          ...(value.streamKey === "" ? {} : { streamKey: value.streamKey }),
        });
      }
    } catch {
      return;
    }
    onClose();
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl bg-secondary/45 p-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-lg font-semibold">
          {t(value.destinationId === undefined ? "addFormTitle" : "editFormTitle")}
        </h3>
        <Button
          aria-label={t("cancel")}
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Icons.cancel aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="restream-platform">{t("platform")}</FieldLabel>
          <select
            className="h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            id="restream-platform"
            onChange={(event) =>
              setValue((current) => ({
                ...current,
                platform: event.target.value as RestreamPlatform,
              }))
            }
            value={value.platform}
          >
            {(["youtube", "twitch", "kick", "custom"] as const).map((platform) => (
              <option key={platform} value={platform}>
                {t(platform)}
              </option>
            ))}
          </select>
          {helpUrl && (
            <FieldDescription>
              <a
                className="inline-flex items-center gap-1 text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href={helpUrl}
                rel="noreferrer"
                target="_blank"
              >
                {t("platformHelp")}
                <Icons.externalLink aria-hidden="true" className="size-3" />
              </a>
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="restream-label">{t("label")}</FieldLabel>
          <Input
            id="restream-label"
            maxLength={64}
            onChange={(event) => setValue((current) => ({ ...current, label: event.target.value }))}
            placeholder={t("labelPlaceholder")}
            required
            value={value.label}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="restream-server">{t("serverUrl")}</FieldLabel>
          <Input
            autoCapitalize="none"
            autoCorrect="off"
            id="restream-server"
            maxLength={2048}
            onChange={(event) =>
              setValue((current) => ({ ...current, serverUrl: event.target.value }))
            }
            placeholder={t("serverPlaceholder")}
            required
            spellCheck={false}
            value={value.serverUrl}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="restream-destination-key">{t("destinationKey")}</FieldLabel>
          <Input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            id="restream-destination-key"
            maxLength={512}
            onChange={(event) =>
              setValue((current) => ({ ...current, streamKey: event.target.value }))
            }
            placeholder={
              value.streamKeyHint
                ? t("unchangedKey", { hint: value.streamKeyHint })
                : t("keyPlaceholder")
            }
            required={value.destinationId === undefined}
            spellCheck={false}
            type="password"
            value={value.streamKey}
          />
        </Field>
      </div>
      {mutation.isError && <FieldError>{t("saveError")}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} type="button" variant="ghost">
          {t("cancel")}
        </Button>
        <Button disabled={mutation.isPending} type="submit">
          {mutation.isPending ? (
            <Icons.loader aria-hidden="true" className="animate-spin" />
          ) : (
            <Icons.save aria-hidden="true" />
          )}
          {t(mutation.isPending ? "saving" : "save")}
        </Button>
      </div>
    </form>
  );
}

function DestinationList({
  destinations,
  isLive,
  sessionDestinations,
}: {
  destinations: RestreamDestination[];
  isLive: boolean;
  sessionDestinations: RestreamSession["destinations"];
}) {
  const { t } = useI18n(i18n);
  const { deleteDestination, setDestinationEnabled } = useRestreamMutations();
  const [draft, setDraft] = useState<DestinationDraft | null>(null);
  const limitReached = destinations.length >= 3;
  const mutationBusy = deleteDestination.isPending || setDestinationEnabled.isPending;
  const mutationError = deleteDestination.isError || setDestinationEnabled.isError;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            {t("destinationHeading")}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("destinationDescription")}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                disabled={limitReached || isLive || draft !== null}
                onClick={() => setDraft(emptyDraft)}
                size="sm"
                type="button"
              >
                <Icons.addSource aria-hidden="true" />
                {t("addDestination")}
              </Button>
            }
          />
          {limitReached && <TooltipContent>{t("destinationLimit")}</TooltipContent>}
        </Tooltip>
      </div>
      {destinations.length === 0 && draft === null ? (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
            <Icons.platform aria-hidden="true" className="size-5" />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">{t("noDestinations")}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("noDestinationsDescription")}
            </p>
          </div>
        </div>
      ) : (
        <div>
          {destinations.map((destination) => (
            <DestinationRow
              destination={destination}
              isLive={isLive}
              key={destination.destinationId}
              liveState={sessionDestinations.find(
                (state) => state.destinationId === destination.destinationId,
              )}
              mutationBusy={mutationBusy}
              mutationError={mutationError}
              onDelete={() =>
                deleteDestination.mutate({ destinationId: destination.destinationId })
              }
              onEdit={() =>
                setDraft({
                  destinationId: destination.destinationId,
                  platform: destination.platform,
                  label: destination.label,
                  serverUrl: destination.serverUrl,
                  streamKey: "",
                  streamKeyHint: destination.streamKeyHint,
                })
              }
              onToggle={(enabled) =>
                setDestinationEnabled.mutate({
                  destinationId: destination.destinationId,
                  enabled,
                })
              }
            />
          ))}
        </div>
      )}
      {draft && <DestinationForm draft={draft} onClose={() => setDraft(null)} />}
    </section>
  );
}

function PlanAside({ plan }: { plan: RestreamConfig["plan"] }) {
  const { locale, t } = useI18n(i18n);
  const monthlyPrice = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(plan.monthlyPriceUsdCents / 100);
  return (
    <aside className="flex flex-col gap-5 border-t border-border/75 pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
      <section className="flex flex-col gap-3 rounded-2xl bg-secondary/55 p-4">
        <div className="flex items-center gap-2 text-secondary-foreground">
          <Icons.multistream aria-hidden="true" className="size-4" />
          <h2 className="text-sm font-semibold">{t("betaPlan")}</h2>
        </div>
        <p className="font-heading text-2xl font-semibold tracking-tight">
          {t("monthlyPrice", { amount: monthlyPrice })}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("planIncludes", { count: plan.maxDestinations })}
        </p>
        <Button disabled type="button" variant="outline">
          <Icons.secure aria-hidden="true" />
          {t("paymentSoon")}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("betaAccess")}</p>
      </section>
      <section className="flex flex-col gap-2 px-1">
        <div className="flex items-center gap-2">
          <Icons.activity aria-hidden="true" className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("compatibility")}</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("compatibilityDescription")}
        </p>
      </section>
    </aside>
  );
}

function MultistreamPage() {
  const { t } = useI18n(i18n);
  const configQ = useRestreamConfigQ();
  const config = configQ.data;
  if (configQ.isError) {
    return (
      <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <CosmicPageHeader title={t("multistream")} variant="signal" />
        <QueryErrorState
          className="min-h-0 flex-1"
          isRetrying={configQ.isFetching}
          onRetry={() => void configQ.refetch()}
        />
      </section>
    );
  }
  if (!config) {
    return (
      <section
        aria-busy="true"
        className="cosmic-panel flex h-full min-h-0 min-w-0 animate-pulse flex-col overflow-hidden"
      >
        <CosmicPageHeader title={t("multistream")} variant="signal" />
        <div className="m-5 h-32 rounded-2xl bg-muted/60" />
      </section>
    );
  }
  const isLive = config.session !== null;
  const enabledCount = config.destinations.filter((destination) => destination.enabled).length;

  return (
    <section className="cosmic-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CosmicPageHeader title={t("multistream")} variant="signal" />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-3 sm:p-5">
        <div className="flex flex-col gap-1 px-1">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p>
        </div>
        <SignalRail destinationCount={enabledCount} status={config.session?.status} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-7">
            <IngestSetup ingest={config.ingest} isLive={isLive} />
            <DestinationList
              destinations={config.destinations}
              isLive={isLive}
              sessionDestinations={config.session?.destinations ?? []}
            />
          </div>
          <PlanAside plan={config.plan} />
        </div>
      </div>
    </section>
  );
}
