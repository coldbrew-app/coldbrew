import type {
  ChatBroadcastResult,
  ChatProvider,
  ChatProviderAvailability,
  ChatSourceId,
} from "@coldbrew/packages/chat.js";
import { MAX_CHAT_MESSAGE_LENGTH } from "@coldbrew/packages/chat.js";
import { createFileRoute } from "@tanstack/react-router";
import { ChatFeed } from "@web/components/chat-feed";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Icons, PlatformIcons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { useChatServiceMutations, useChatServiceQueries } from "@web/hooks/chat-service";
import { useChatServiceStream } from "@web/hooks/use-chat-service-stream";
import { useI18n } from "@web/lib/i18n";
import { cn } from "@web/lib/utils";
import { useState, type FormEvent } from "react";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
  head: ({ match }) => ({
    meta: [{ title: `${match.context.locale === "ru" ? "Мультичат" : "Multichat"} · Coldbrew` }],
  }),
});

const providerMeta = {
  youtube: { label: "YouTube", color: "#ff4057", logo: PlatformIcons.youtube },
  twitch: { label: "Twitch", color: "#9146ff", logo: PlatformIcons.twitch },
  kick: { label: "Kick", color: "#53fc18", logo: PlatformIcons.kick },
  boosty: { label: "Boosty", color: "#f15f2c", logo: PlatformIcons.boosty },
  vk_video: { label: "VK Video", color: "#2688eb", logo: PlatformIcons.vk_video },
} as const;

const copy = {
  ru: {
    eyebrow: "Единый эфир · полный контроль",
    description:
      "Подключите собственные каналы, следите за общей лентой и отвечайте во все доступные чаты одной отправкой.",
    connections: "Каналы",
    connectHelp: "Можно подключить несколько аккаунтов каждого сервиса.",
    feed: "Общий эфир",
    empty: "Сообщения появятся здесь, когда подключённый канал выйдет в эфир.",
    composer: "Во все доступные чаты",
    placeholder: "Написать одновременно в YouTube, Twitch и Kick…",
    send: "Отправить всем",
    noConnections: "Пока нет подключённых каналов",
    disconnect: "Отключить",
    connect: "Подключить",
    unavailable: "Недоступно",
    readOnly: "Только чтение",
    live: "в эфире",
    offline: "не в эфире",
    connecting: "подключение",
    error: "ошибка",
    checkStream: "Проверить эфир",
    checkingStream: "Проверяем",
    overlay: "Ссылка для OBS",
    rotateOverlay: "Обновить",
    createOverlay: "Создать",
    copied: "Скопировано",
    copy: "Копировать",
    loading: "Подключаем центр управления чатами…",
  },
  en: {
    eyebrow: "One signal · full control",
    description:
      "Connect your own channels, watch one feed, and send one message to every writable chat.",
    connections: "Channels",
    connectHelp: "You can connect multiple accounts from each provider.",
    feed: "Unified signal",
    empty: "Messages will appear when a connected channel goes live.",
    composer: "To every available chat",
    placeholder: "Send to YouTube, Twitch, and Kick at once…",
    send: "Send to all",
    noConnections: "No connected channels yet",
    disconnect: "Disconnect",
    connect: "Connect",
    unavailable: "Unavailable",
    readOnly: "Read only",
    live: "live",
    offline: "offline",
    connecting: "connecting",
    error: "error",
    checkStream: "Check stream",
    checkingStream: "Checking",
    overlay: "OBS link",
    rotateOverlay: "Rotate",
    createOverlay: "Create",
    copied: "Copied",
    copy: "Copy",
    loading: "Connecting the chat control room…",
  },
} as const;

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
  const text = copy[locale];
  const normalized = state ?? "offline";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
      {text[normalized]}
    </span>
  );
}

function ChatPage() {
  const { locale } = useI18n();
  const text = copy[locale];
  const {
    availabilityQuery,
    client: chatClient,
    configQuery,
    ticketQuery,
  } = useChatServiceQueries();
  const stream = useChatServiceStream(chatClient);
  const [message, setMessage] = useState("");
  const [broadcastResult, setBroadcastResult] = useState<ChatBroadcastResult | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [overlayCopied, setOverlayCopied] = useState(false);

  const { broadcast, disconnect, moderate, refreshSource, rotateOverlay, startOauth } =
    useChatServiceMutations(chatClient, {
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
    return source ? (connectionsById.get(source.connectionId)?.capabilities ?? []) : [];
  };
  const availability: ChatProviderAvailability[] = availabilityQuery.data ?? [];
  const writableConnectionCount =
    config?.connections.filter(
      ({ capabilities, status }) => status === "connected" && capabilities.includes("send_message"),
    ).length ?? 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || broadcast.isPending) {
      return;
    }
    setBroadcastResult(null);
    broadcast.mutate(message);
  };

  if (!config) {
    return (
      <section className="flex min-h-full flex-col gap-4">
        <CosmicPageHeader
          description={text.description}
          eyebrow={text.eyebrow}
          title={locale === "ru" ? "Мультичат" : "Multichat"}
        />
        <div className="cosmic-panel grid min-h-64 place-items-center p-6 text-center">
          {ticketQuery.isError || configQuery.isError ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-destructive">
                {ticketQuery.error?.message ?? configQuery.error?.message}
              </p>
              <Button onClick={() => void ticketQuery.refetch()} variant="outline">
                <Icons.retry aria-hidden="true" />
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icons.loader className="animate-spin text-primary" />
              {text.loading}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-full min-w-0 flex-1 flex-col gap-4">
      <CosmicPageHeader
        description={text.description}
        eyebrow={text.eyebrow}
        title={locale === "ru" ? "Мультичат" : "Multichat"}
      />
      <div className="grid min-h-[680px] gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="cosmic-panel flex min-h-0 flex-col overflow-hidden">
          <header className="flex flex-col gap-1 border-b border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-xl font-semibold">{text.connections}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {config.connections.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{text.connectHelp}</p>
          </header>

          <div className="flex min-h-0 grow flex-col gap-2 overflow-y-auto p-3">
            {config.connections.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {text.noConnections}
              </div>
            )}
            {config.connections.map((connection) => {
              const source = sourceByConnection.get(connection.connectionId);
              const sourceState = source ? stream.statuses[source.sourceId] : undefined;
              const isRefreshing =
                source !== undefined &&
                refreshSource.isPending &&
                refreshSource.variables === source.sourceId;
              return (
                <article
                  className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-muted/30 p-3"
                  key={connection.connectionId}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-0.5"
                    style={{ backgroundColor: providerMeta[connection.provider].color }}
                  />
                  <div className="flex items-center gap-2">
                    <ProviderMark provider={connection.provider} />
                    <div className="min-w-0 grow">
                      <p className="truncate text-sm font-semibold">{connection.displayName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {providerMeta[connection.provider].label}
                      </p>
                    </div>
                    <SourceState
                      {...(source
                        ? sourceState
                          ? { state: sourceState }
                          : {}
                        : { state: "error" })}
                      locale={locale}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {!connection.capabilities.includes("send_message") && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {text.readOnly}
                      </span>
                    )}
                    <div className="flex grow justify-end gap-1">
                      {connection.provider === "youtube" && source && (
                        <Button
                          disabled={
                            refreshSource.isPending ||
                            sourceState === "live" ||
                            sourceState === "connecting"
                          }
                          onClick={() => refreshSource.mutate(source.sourceId)}
                          size="xs"
                          variant="ghost"
                        >
                          {isRefreshing ? (
                            <Icons.loader aria-hidden="true" className="animate-spin" />
                          ) : (
                            <Icons.retry aria-hidden="true" />
                          )}
                          {isRefreshing ? text.checkingStream : text.checkStream}
                        </Button>
                      )}
                      <Button
                        disabled={disconnect.isPending}
                        onClick={() => disconnect.mutate(connection.connectionId)}
                        size="xs"
                        variant="ghost"
                      >
                        {text.disconnect}
                      </Button>
                    </div>
                  </div>
                  {source &&
                    refreshSource.isError &&
                    refreshSource.variables === source.sourceId && (
                      <p className="text-[11px] text-destructive">{refreshSource.error.message}</p>
                    )}
                </article>
              );
            })}

            <div className="flex flex-col gap-2 pt-1">
              {availability.map((provider) => {
                const meta = providerMeta[provider.provider];
                const connectable =
                  provider.access !== "unavailable" &&
                  (provider.provider === "youtube" ||
                    provider.provider === "twitch" ||
                    provider.provider === "kick");
                return (
                  <Button
                    className="h-auto   justify-start gap-2 p-2.5"
                    disabled={!connectable || startOauth.isPending}
                    key={provider.provider}
                    onClick={() => {
                      if (
                        provider.provider === "youtube" ||
                        provider.provider === "twitch" ||
                        provider.provider === "kick"
                      ) {
                        startOauth.mutate(provider.provider);
                      }
                    }}
                    title={provider.detail}
                    variant="outline"
                  >
                    <ProviderMark provider={provider.provider} />
                    <span className="flex min-w-0 grow flex-col items-start">
                      <span>{meta.label}</span>
                      <span className="max-w-full truncate text-[10px] font-normal text-muted-foreground">
                        {connectable
                          ? text.connect
                          : provider.access === "read_only"
                            ? text.readOnly
                            : text.unavailable}
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
              <span className="text-xs text-muted-foreground">{text.overlay}</span>
              <Button
                disabled={rotateOverlay.isPending}
                onClick={() => rotateOverlay.mutate()}
                size="xs"
                variant="ghost"
              >
                <Icons.rotateToken aria-hidden="true" />
                {config.hasOverlayToken ? text.rotateOverlay : text.createOverlay}
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
                {overlayCopied ? text.copied : text.copy}
              </Button>
            )}
          </footer>
        </aside>

        <article className="cosmic-panel flex min-h-[620px] min-w-0 flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b border-border p-4">
            <div className="min-w-0 grow">
              <h2 className="font-heading text-xl font-semibold">{text.feed}</h2>
              <p className="text-xs text-muted-foreground">
                {config.sources.length} sources · {stream.messages.length} messages
              </p>
            </div>
            <div className="flex h-7 items-end gap-1" aria-hidden="true">
              {config.sources.slice(0, 8).map((source, index) => (
                <span
                  className="w-1 rounded-full"
                  key={source.sourceId}
                  style={{
                    backgroundColor: providerMeta[source.provider].color,
                    height: `${12 + (index % 3) * 6}px`,
                  }}
                />
              ))}
            </div>
          </header>
          <ChatFeed
            capabilitiesForSource={capabilitiesForSource}
            emptyLabel={stream.connectionError?.detail ?? text.empty}
            messages={stream.messages}
            onModerate={(command) => moderate.mutate(command)}
          />
          <form
            className="flex flex-col gap-2 border-t border-border bg-background/85 p-3 backdrop-blur"
            onSubmit={submit}
          >
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-[0.12em]">{text.composer}</span>
              <span className="h-px grow bg-border" />
              {config.connections
                .filter(({ capabilities }) => capabilities.includes("send_message"))
                .map(({ connectionId, provider }) => (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    key={connectionId}
                    style={{ backgroundColor: providerMeta[provider].color }}
                  />
                ))}
            </div>
            <div className="flex gap-2">
              <Input
                maxLength={MAX_CHAT_MESSAGE_LENGTH}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={text.placeholder}
                value={message}
              />
              <Button
                disabled={!message.trim() || broadcast.isPending || writableConnectionCount === 0}
                type="submit"
              >
                {broadcast.isPending ? (
                  <Icons.loader aria-hidden="true" className="animate-spin" />
                ) : (
                  <Icons.send aria-hidden="true" />
                )}
                <span className="hidden sm:inline">{text.send}</span>
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
      </div>
    </section>
  );
}
