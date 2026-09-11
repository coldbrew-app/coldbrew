import type {
  ChatBroadcastResult,
  ChatProvider,
  ChatProviderAvailability,
  ChatProviderConnection,
  ChatSourceId,
} from "@coldbrew/packages/chat.js";
import { MAX_CHAT_MESSAGE_LENGTH } from "@coldbrew/packages/chat.js";
import { createFileRoute } from "@tanstack/react-router";
import { BoostyConnectionForm } from "@web/components/boosty-connection-form";
import { ChatFeed } from "@web/components/chat-feed";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Icons, PlatformIcons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@web/components/ui/dialog";
import { Input } from "@web/components/ui/input";
import { Switch } from "@web/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@web/components/ui/tooltip";
import { useChatServiceMutations, useChatServiceQueries } from "@web/hooks/chat-service";
import { useChatServiceStream } from "@web/hooks/use-chat-service-stream";
import { createI18n, createTranslator, useI18n, type TranslationKey } from "@web/lib/i18n";
import { cn } from "@web/lib/utils";
import { useState, type FormEvent } from "react";
import { z } from "zod";

const i18n = createI18n({
  chat: {
    en: "Multichat",
    ru: "Мультичат",
  },
  dismissChatOauthNotification: {
    en: "Dismiss connection notification",
    ru: "Скрыть уведомление о подключении",
  },
  chatOauthSuccess: {
    en: "Chat account connected.",
    ru: "Аккаунт чата подключён.",
  },
  chatOauthInvalidCallback: {
    en: "The authorization response was incomplete. Try connecting again.",
    ru: "Ответ авторизации неполный. Попробуйте подключить аккаунт снова.",
  },
  chatOauthExpired: {
    en: "Authorization expired. Try connecting again.",
    ru: "Время авторизации истекло. Попробуйте подключить аккаунт снова.",
  },
  chatOauthProviderUnavailable: {
    en: "This chat provider is not configured.",
    ru: "Этот сервис чата не настроен.",
  },
  chatOauthTokenExchangeFailed: {
    en: "The provider rejected the authorization request.",
    ru: "Сервис отклонил запрос авторизации.",
  },
  chatOauthProfileFailed: {
    en: "Couldn't load or subscribe to the provider channel.",
    ru: "Не удалось получить канал или подписаться на его события.",
  },
  chatOauthSourceLimitReached: {
    en: "The connected chat channel limit has been reached.",
    ru: "Достигнут лимит подключённых каналов чата.",
  },
  chatOauthUnknownError: {
    en: "Couldn't connect the chat account. Try again.",
    ru: "Не удалось подключить аккаунт чата. Попробуйте снова.",
  },
  chatDisconnectTitle: {
    en: "Disconnect channel?",
    ru: "Отключить канал?",
  },
  chatDisconnectDescription: {
    en: ({ name, provider }: { name: string; provider: string }) =>
      `Messages from ${name} on ${provider} will no longer appear in the chat. You can reconnect the channel later.`,
    ru: ({ name, provider }: { name: string; provider: string }) =>
      `Сообщения канала «${name}» в ${provider} больше не будут появляться в чате. Канал можно подключить снова.`,
  },
  cancel: {
    en: "Cancel",
    ru: "Отменить",
  },
});

const chatOauthErrorSchema = z.enum([
  "invalid oauth callback",
  "expired oauth attempt",
  "oauth provider unavailable",
  "oauth token exchange failed",
  "oauth profile failed",
  "chat source limit reached",
  "unknown",
]);

const chatOauthErrorMessages = {
  "invalid oauth callback": "chatOauthInvalidCallback",
  "expired oauth attempt": "chatOauthExpired",
  "oauth provider unavailable": "chatOauthProviderUnavailable",
  "oauth token exchange failed": "chatOauthTokenExchangeFailed",
  "oauth profile failed": "chatOauthProfileFailed",
  "chat source limit reached": "chatOauthSourceLimitReached",
  unknown: "chatOauthUnknownError",
} as const satisfies Record<z.infer<typeof chatOauthErrorSchema>, TranslationKey<typeof i18n>>;

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
  validateSearch: z.object({
    chat_oauth: z.enum(["success", "error"]).optional().catch(undefined),
    chat_oauth_error: chatOauthErrorSchema.optional().catch(undefined),
  }),
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale, i18n)("chat")} · Coldbrew` }],
  }),
});

const providerMeta = {
  youtube: { label: "YouTube", color: "#ff4057", logo: PlatformIcons.youtube },
  twitch: { label: "Twitch", color: "#9146ff", logo: PlatformIcons.twitch },
  kick: { label: "Kick", color: "#53fc18", logo: PlatformIcons.kick },
  boosty: { label: "Boosty", color: "#f15f2c", logo: PlatformIcons.boosty },
  vk_video: { label: "VK Video", color: "#2688eb", logo: PlatformIcons.vk_video },
} as const;

const copy = createI18n({
  connections: {
    en: "Channels",
    ru: "Каналы",
  },
  feed: {
    en: "Chat",
    ru: "Чат",
  },
  empty: {
    en: "Messages will appear when a connected channel goes live.",
    ru: "Сообщения появятся здесь, когда подключённый канал выйдет в эфир.",
  },
  placeholder: {
    en: "Send to all chats…",
    ru: "Сообщение",
  },
  send: {
    en: "Send to all",
    ru: "Отправить всем",
  },
  noConnections: {
    en: "No connected channels yet",
    ru: "Пока нет подключённых каналов",
  },
  disconnect: {
    en: "Disconnect",
    ru: "Отключить",
  },
  disconnectAccount: {
    en: "Disconnect account",
    ru: "Отключить аккаунт",
  },
  enableSource: {
    en: "Enable source",
    ru: "Включить источник",
  },
  disableSource: {
    en: "Disable source",
    ru: "Выключить источник",
  },
  connect: {
    en: "Connect",
    ru: "Подключить",
  },
  unavailable: {
    en: "Unavailable",
    ru: "Недоступно",
  },
  readOnly: {
    en: "Read only",
    ru: "Только чтение",
  },
  live: {
    en: "live",
    ru: "в эфире",
  },
  offline: {
    en: "offline",
    ru: "не в эфире",
  },
  connecting: {
    en: "connecting",
    ru: "подключение",
  },
  error: {
    en: "error",
    ru: "ошибка",
  },
  checkStream: {
    en: "Check stream",
    ru: "Проверить эфир",
  },
  checkingStream: {
    en: "Checking",
    ru: "Проверяем",
  },
  overlay: {
    en: "OBS link",
    ru: "Ссылка для OBS",
  },
  rotateOverlay: {
    en: "Rotate",
    ru: "Обновить",
  },
  createOverlay: {
    en: "Create",
    ru: "Создать",
  },
  copied: {
    en: "Copied",
    ru: "Скопировано",
  },
  copy: {
    en: "Copy",
    ru: "Копировать",
  },
  loading: {
    en: "Connecting the chat control room…",
    ru: "Подключаем центр управления чатами…",
  },
});

function ProviderMark({ provider }: { provider: ChatProvider }) {
  const meta = providerMeta[provider];
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-background"
    >
      <img alt="" className="size-5" src={meta.logo} />
    </span>
  );
}

function SourceState({
  state,
  locale,
}: {
  state?: "connecting" | "error" | "live" | "offline";
  locale: "ru" | "en";
}) {
  const t = createTranslator(locale, copy);
  const normalized = state ?? "offline";
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={t(normalized)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden="true" className="flex size-3 shrink-0 items-center justify-center">
          <span
            className={cn(
              "size-1.5 rounded-full",
              normalized === "live"
                ? "bg-emerald-500"
                : normalized === "error"
                  ? "bg-destructive"
                  : normalized === "connecting"
                    ? "animate-pulse bg-amber-500"
                    : "bg-muted-foreground/40",
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{t(normalized)}</TooltipContent>
    </Tooltip>
  );
}

function ChatPage() {
  const { locale, t } = useI18n(i18n);
  const { chat_oauth: chatOauth, chat_oauth_error: chatOauthError } = Route.useSearch();
  const navigate = Route.useNavigate();
  const copyT = createTranslator(locale, copy);
  const { availabilityQuery, configQuery } = useChatServiceQueries();
  const stream = useChatServiceStream();
  const [boostyFormOpen, setBoostyFormOpen] = useState(false);
  const [connectionToDisconnect, setConnectionToDisconnect] =
    useState<ChatProviderConnection | null>(null);
  const [message, setMessage] = useState("");
  const [broadcastResult, setBroadcastResult] = useState<ChatBroadcastResult | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [overlayCopied, setOverlayCopied] = useState(false);

  const {
    broadcast,
    disconnect,
    moderate,
    refreshSource,
    rotateOverlay,
    setSourceEnabled,
    startOauth,
  } = useChatServiceMutations({
    onBroadcastSuccess: (result) => {
      setBroadcastResult(result);
      if (result.results.some(({ status }) => status === "succeeded")) {
        setMessage("");
      }
    },
    onMessageDeleted: (sourceId, messageId) => stream.removeMessage(sourceId, messageId),
    onOverlayUrlChanged: (nextOverlayUrl) => {
      setOverlayUrl(nextOverlayUrl);
      setOverlayCopied(false);
    },
  });

  const config = configQuery.data;
  const connectionsById = new Map(
    config?.connections.map((connection) => [connection.connectionId, connection]),
  );
  const sourceByConnection = new Map(
    config?.sources.map((source) => [source.connectionId, source]),
  );
  const sourceById = new Map(config?.sources.map((source) => [source.sourceId, source]));
  const capabilitiesForSource = (sourceId: ChatSourceId) => {
    const source = sourceById.get(sourceId);
    return source?.enabled ? (connectionsById.get(source.connectionId)?.capabilities ?? []) : [];
  };
  const availability: ChatProviderAvailability[] = availabilityQuery.data ?? [];
  const writableConnectionCount =
    config?.sources.filter((source) => {
      const connection = connectionsById.get(source.connectionId);
      return (
        source.enabled &&
        connection?.status === "connected" &&
        connection.capabilities.includes("send_message")
      );
    }).length ?? 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || broadcast.isPending) {
      return;
    }
    setBroadcastResult(null);
    broadcast.mutate({ text: message });
  };

  if (!config) {
    return (
      <section className="cosmic-panel grid h-full min-h-0 place-items-center overflow-hidden p-6 text-center">
        {configQuery.isError ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-destructive">{configQuery.error?.message}</p>
            <Button onClick={() => void configQuery.refetch()} variant="outline">
              <Icons.retry aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icons.loader className="animate-spin text-primary" />
            {copyT("loading")}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {chatOauth && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px]",
            chatOauth === "success"
              ? "border-emerald-300/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
              : "border-red-300/50 bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300",
          )}
          role={chatOauth === "error" ? "alert" : "status"}
        >
          <p className="min-w-0 grow">
            {chatOauth === "success"
              ? t("chatOauthSuccess")
              : t(chatOauthErrorMessages[chatOauthError ?? "unknown"])}
          </p>
          <Button
            aria-label={t("dismissChatOauthNotification")}
            className="text-current hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
            onClick={() =>
              void navigate({
                replace: true,
                search: (previous) => ({
                  ...previous,
                  chat_oauth: undefined,
                  chat_oauth_error: undefined,
                }),
              })
            }
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Icons.cancel aria-hidden="true" />
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain xl:grid xl:grid-cols-[330px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden">
        <article className="cosmic-panel isolate flex h-[max(24rem,55dvh)] min-h-0 min-w-0 shrink-0 flex-col overflow-hidden xl:h-auto">
          <CosmicPageHeader
            actions={
              <a
                href="#chat-connections"
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[#fff8ed] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff8ed] xl:hidden"
              >
                {copyT("connections")}
              </a>
            }
            headingLevel={2}
            title={copyT("feed")}
            variant="signal"
          />
          <ChatFeed
            capabilitiesForSource={capabilitiesForSource}
            emptyLabel={stream.connectionError?.detail ?? copyT("empty")}
            messages={stream.messages}
            onModerate={(command) => moderate.mutate(command)}
          />
          <form
            className="flex shrink-0 flex-col gap-2 border-t border-border bg-card p-3"
            onSubmit={submit}
          >
            <div className="flex gap-2">
              <Input
                maxLength={MAX_CHAT_MESSAGE_LENGTH}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={copyT("placeholder")}
                value={message}
              />
              <Button
                aria-label={copyT("send")}
                disabled={!message.trim() || broadcast.isPending || writableConnectionCount === 0}
                type="submit"
              >
                {broadcast.isPending ? (
                  <Icons.loader aria-hidden="true" className="animate-spin" />
                ) : (
                  <Icons.send aria-hidden="true" />
                )}
                <span className="hidden sm:inline">{copyT("send")}</span>
              </Button>
            </div>
            {broadcastResult && (
              <div className="flex flex-wrap gap-1.5">
                {broadcastResult.results.map((result) => {
                  const source = sourceById.get(result.sourceId);
                  return (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px]",
                        result.status === "succeeded"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : result.status === "unsupported"
                            ? "bg-muted text-muted-foreground"
                            : "bg-destructive/10 text-destructive",
                      )}
                      key={result.sourceId}
                      title={result.detail}
                    >
                      {source?.displayName ?? result.sourceId}: {result.status}
                    </span>
                  );
                })}
              </div>
            )}
            {(broadcast.error || moderate.error || startOauth.error) && (
              <p className="text-xs text-destructive">
                {broadcast.error?.message ?? moderate.error?.message ?? startOauth.error?.message}
              </p>
            )}
          </form>
        </article>
        <aside
          id="chat-connections"
          className="cosmic-panel flex min-h-0 shrink-0 scroll-mt-4 flex-col overflow-hidden xl:order-first"
        >
          <CosmicPageHeader headingLevel={2} title={copyT("connections")} variant="beans" />

          <div className="flex min-h-0 grow flex-col gap-2 overflow-y-auto p-3">
            {config.connections.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {copyT("noConnections")}
              </div>
            )}
            {config.connections.map((connection) => {
              const source = sourceByConnection.get(connection.connectionId);
              const sourceState = source ? stream.statuses[source.sourceId] : undefined;
              const isRefreshing =
                source !== undefined &&
                refreshSource.isPending &&
                refreshSource.variables?.sourceId === source.sourceId;
              return (
                <article
                  className={cn(
                    "relative flex shrink-0 flex-col gap-2 overflow-hidden rounded-xl border border-border p-3 transition-colors",
                    source?.enabled === false ? "bg-muted/55" : "bg-muted/30",
                  )}
                  key={connection.connectionId}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger
                          aria-label={providerMeta[connection.provider].label}
                          className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <ProviderMark provider={connection.provider} />
                        </TooltipTrigger>
                        <TooltipContent>{providerMeta[connection.provider].label}</TooltipContent>
                      </Tooltip>
                      <div className="flex min-w-0 items-center">
                        {source ? (
                          <a
                            className="min-w-0 rounded-sm break-words text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            href={source.sourceUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            {connection.displayName}
                          </a>
                        ) : (
                          <p className="min-w-0 break-words text-sm font-semibold">
                            {connection.displayName}
                          </p>
                        )}
                        {source?.enabled !== false && (
                          <SourceState
                            {...(source
                              ? sourceState
                                ? { state: sourceState }
                                : {}
                              : { state: "error" })}
                            locale={locale}
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-1">
                        {(connection.provider === "youtube" ||
                          connection.provider === "vk_video") &&
                          source?.enabled && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    aria-label={
                                      isRefreshing ? copyT("checkingStream") : copyT("checkStream")
                                    }
                                    disabled={
                                      refreshSource.isPending ||
                                      sourceState === "live" ||
                                      sourceState === "connecting"
                                    }
                                    onClick={() =>
                                      refreshSource.mutate({ sourceId: source.sourceId })
                                    }
                                    size="icon-xs"
                                    variant="ghost"
                                  />
                                }
                              >
                                {isRefreshing ? (
                                  <Icons.loader aria-hidden="true" className="animate-spin" />
                                ) : (
                                  <Icons.retry aria-hidden="true" />
                                )}
                              </TooltipTrigger>
                              <TooltipContent>
                                {isRefreshing ? copyT("checkingStream") : copyT("checkStream")}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                aria-label={copyT("disconnectAccount")}
                                disabled={disconnect.isPending}
                                onClick={() => {
                                  disconnect.reset();
                                  setConnectionToDisconnect(connection);
                                }}
                                size="icon-xs"
                                variant="ghost"
                              />
                            }
                          >
                            <Icons.removeSource aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent>{copyT("disconnectAccount")}</TooltipContent>
                        </Tooltip>
                      </div>
                      {source && (
                        <Switch
                          aria-label={`${source.enabled ? copyT("disableSource") : copyT("enableSource")}: ${connection.displayName}`}
                          checked={source.enabled}
                          className="data-checked:bg-emerald-500 dark:data-checked:bg-emerald-500"
                          disabled={setSourceEnabled.isPending}
                          onCheckedChange={(enabled) =>
                            setSourceEnabled.mutate({ enabled, sourceId: source.sourceId })
                          }
                          size="sm"
                        />
                      )}
                    </div>
                  </div>
                  {source &&
                    refreshSource.isError &&
                    refreshSource.variables?.sourceId === source.sourceId && (
                      <p className="text-[11px] text-destructive">{refreshSource.error.message}</p>
                    )}
                  {source &&
                    setSourceEnabled.isError &&
                    setSourceEnabled.variables?.sourceId === source.sourceId && (
                      <p role="alert" className="text-[11px] text-destructive">
                        {setSourceEnabled.error.message}
                      </p>
                    )}
                </article>
              );
            })}

            <div className="flex flex-col gap-2 pt-1">
              {boostyFormOpen && <BoostyConnectionForm onClose={() => setBoostyFormOpen(false)} />}
              {availability.map((provider) => {
                const meta = providerMeta[provider.provider];
                const connectable =
                  provider.access !== "unavailable" &&
                  (provider.provider === "youtube" ||
                    provider.provider === "twitch" ||
                    provider.provider === "kick" ||
                    provider.provider === "vk_video" ||
                    provider.provider === "boosty");
                return (
                  <Button
                    className="h-auto   justify-start gap-2 p-2.5"
                    disabled={!connectable || startOauth.isPending}
                    key={provider.provider}
                    onClick={() => {
                      if (provider.provider === "boosty") {
                        setBoostyFormOpen(true);
                        return;
                      }
                      if (
                        provider.provider === "youtube" ||
                        provider.provider === "twitch" ||
                        provider.provider === "kick" ||
                        provider.provider === "vk_video"
                      ) {
                        startOauth.mutate({ provider: provider.provider });
                      }
                    }}
                    title={provider.detail}
                    variant="outline"
                  >
                    <ProviderMark provider={provider.provider} />
                    <span className="flex min-w-0 grow flex-col items-start">
                      <span>{meta.label}</span>
                      <span className="max-w-full truncate text-[10px] font-normal text-muted-foreground">
                        {provider.access === "read_only"
                          ? copyT("readOnly")
                          : connectable
                            ? copyT("connect")
                            : copyT("unavailable")}
                      </span>
                    </span>
                    <Icons.addSource aria-hidden="true" />
                  </Button>
                );
              })}
            </div>
          </div>

          <footer className="flex flex-col gap-2 border-t border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{copyT("overlay")}</span>
              <Button
                disabled={rotateOverlay.isPending}
                onClick={() => rotateOverlay.mutate()}
                size="xs"
                variant="ghost"
              >
                <Icons.rotateToken aria-hidden="true" />
                {config.hasOverlayToken ? copyT("rotateOverlay") : copyT("createOverlay")}
              </Button>
            </div>
            {overlayUrl !== null && (
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(overlayUrl);
                  setOverlayCopied(true);
                }}
                size="xs"
                variant="outline"
              >
                <Icons.copy aria-hidden="true" />
                {overlayCopied ? copyT("copied") : copyT("copy")}
              </Button>
            )}
          </footer>
        </aside>
      </div>
      <Dialog
        open={connectionToDisconnect !== null}
        onOpenChange={(open) => {
          if (!open && !disconnect.isPending) setConnectionToDisconnect(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{t("chatDisconnectTitle")}</DialogTitle>
          {connectionToDisconnect && (
            <DialogDescription>
              {t("chatDisconnectDescription", {
                name: connectionToDisconnect.displayName,
                provider: providerMeta[connectionToDisconnect.provider].label,
              })}
            </DialogDescription>
          )}
          {disconnect.error && (
            <p role="alert" className="text-sm text-destructive">
              {disconnect.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              disabled={disconnect.isPending}
              onClick={() => setConnectionToDisconnect(null)}
              variant="outline"
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={disconnect.isPending}
              onClick={() => {
                if (!connectionToDisconnect || disconnect.isPending) return;
                disconnect.mutate(
                  { connectionId: connectionToDisconnect.connectionId },
                  { onSuccess: () => setConnectionToDisconnect(null) },
                );
              }}
              variant="destructive"
            >
              {disconnect.isPending && <Icons.loader aria-hidden="true" className="animate-spin" />}
              {copyT("disconnect")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
