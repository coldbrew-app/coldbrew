import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChatFeed } from "@web/components/chat-feed";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Icons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Label } from "@web/components/ui/label";
import { useChatStream } from "@web/hooks/use-chat-stream";
import { parseChatSource } from "@web/lib/chat";
import { useI18n } from "@web/lib/i18n";
import { preloadRouteQuery, useApi } from "@web/lib/trpc";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
  head: () => ({ meta: [{ title: "Chat · Coldbrew" }] }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await preloadRouteQuery(context.queryClient, context.trpc.chat.config.queryOptions());
  },
});

const copy = {
  en: {
    eyebrow: "YouTube + Twitch, one current",
    description: "Combine public live chats without asking streamers to connect platform accounts.",
    sources: "Chat sources",
    sourceHelp: "Add up to 8 YouTube live or Twitch channel links.",
    placeholder: "https://youtube.com/watch?v=… or https://twitch.tv/…",
    add: "Add source",
    save: "Save sources",
    saving: "Saving…",
    invalid: "This link is not a supported YouTube live or Twitch channel URL.",
    duplicate: "This source is already in the list.",
    feed: "Unified feed",
    empty: "Messages will appear when a configured chat goes live.",
    overlay: "OBS browser source",
    overlayHelp:
      "The private URL works without a Coldbrew session. Rotating it disables the old URL immediately.",
    createUrl: "Create OBS URL",
    rotate: "Rotate URL",
    copy: "Copy URL",
    copied: "Copied",
    tokenWarning: "Copy this URL now. Coldbrew stores only its hash and cannot show it again.",
    remove: "Remove source",
  },
  ru: {
    eyebrow: "YouTube + Twitch, один поток",
    description: "Объединяйте публичные чаты без подключения аккаунтов стримера на платформах.",
    sources: "Источники чата",
    sourceHelp: "Добавьте до 8 ссылок на трансляции YouTube или каналы Twitch.",
    placeholder: "https://youtube.com/watch?v=… или https://twitch.tv/…",
    add: "Добавить источник",
    save: "Сохранить источники",
    saving: "Сохраняем…",
    invalid: "Нужна ссылка на трансляцию YouTube или канал Twitch.",
    duplicate: "Этот источник уже добавлен.",
    feed: "Объединённый чат",
    empty: "Сообщения появятся, когда один из настроенных чатов будет в эфире.",
    overlay: "Источник браузера OBS",
    overlayHelp:
      "Секретная ссылка работает без сессии Coldbrew. После ротации старая ссылка сразу отключится.",
    createUrl: "Создать ссылку OBS",
    rotate: "Обновить ссылку",
    copy: "Копировать ссылку",
    copied: "Скопировано",
    tokenWarning:
      "Скопируйте ссылку сейчас. Coldbrew хранит только её хеш и не сможет показать снова.",
    remove: "Удалить источник",
  },
} as const;

function ChatPage() {
  const { locale } = useI18n();
  const text = copy[locale];
  const { queryClient, trpc } = useApi();
  const configQuery = useQuery(trpc.chat.config.queryOptions());
  const config = configQuery.data;
  const [urls, setUrls] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stream = useChatStream(
    "editor",
    undefined,
    config?.sources.map((source) => `${source.provider}:${source.sourceIdentifier}`).join(","),
  );
  const save = useMutation(
    trpc.chat.updateSources.mutationOptions({
      onSuccess: (nextConfig) => {
        queryClient.setQueryData(trpc.chat.config.queryKey(), nextConfig);
      },
    }),
  );
  const rotate = useMutation(
    trpc.chat.rotateOverlayToken.mutationOptions({
      onSuccess: (result) => {
        setOverlayUrl(result.overlayUrl);
        setCopied(false);
        queryClient.invalidateQueries({ queryKey: trpc.chat.config.queryKey() });
      },
    }),
  );

  useEffect(() => {
    if (config) setUrls(config.sources.map((source) => source.sourceUrl));
  }, [config]);

  const addSource = () => {
    if (urls.length >= 8) return;
    const value = input.trim();
    const source = parseChatSource(value);
    if (!source) {
      setInputError(text.invalid);
      return;
    }
    if (
      urls.some((url) => {
        const current = parseChatSource(url);
        return (
          current?.provider === source.provider &&
          current.sourceIdentifier === source.sourceIdentifier
        );
      })
    ) {
      setInputError(text.duplicate);
      return;
    }
    setUrls((current) => [...current, source.sourceUrl]);
    setInput("");
    setInputError(null);
  };

  if (!config) {
    return (
      <section className="flex min-h-full flex-col gap-4">
        <CosmicPageHeader
          description={text.description}
          eyebrow={text.eyebrow}
          title={locale === "ru" ? "Мультичат" : "Multichat"}
        />
        <div className="cosmic-panel flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
          {configQuery.isError ? (
            <>
              <p className="text-sm text-destructive">{configQuery.error.message}</p>
              <Button onClick={() => void configQuery.refetch()} variant="outline">
                <Icons.retry aria-hidden="true" />
                Retry
              </Button>
            </>
          ) : (
            <Icons.loader aria-label="Loading chat" className="animate-spin text-primary" />
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
      <div className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(320px,0.72fr)_minmax(420px,1.28fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <article className="cosmic-panel flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-xl font-semibold">{text.sources}</h2>
              <p className="text-sm text-muted-foreground">{text.sourceHelp}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="chat-source">URL</Label>
              <div className="flex gap-2">
                <Input
                  aria-invalid={Boolean(inputError)}
                  id="chat-source"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addSource();
                    }
                  }}
                  placeholder={text.placeholder}
                  value={input}
                />
                <Button
                  disabled={urls.length >= 8}
                  onClick={addSource}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icons.addSource aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{text.add}</span>
                </Button>
              </div>
              {inputError && <p className="text-xs text-destructive">{inputError}</p>}
            </div>
            <div className="flex flex-col gap-2">
              {urls.map((url, index) => {
                const source = config.sources.find((item) => item.sourceUrl === url);
                const state = source
                  ? stream.statuses[`${source.provider}:${source.sourceIdentifier}`]
                  : undefined;
                return (
                  <div
                    className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/35 p-2"
                    key={`${url}-${index}`}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${state === "live" ? "bg-emerald-500" : state === "error" ? "bg-destructive" : "bg-muted-foreground/40"}`}
                    />
                    <span className="min-w-0 grow truncate text-sm">{url}</span>
                    <Button
                      aria-label={text.remove}
                      onClick={() =>
                        setUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Icons.removeSource aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button disabled={save.isPending} onClick={() => save.mutate({ urls })} type="button">
              {save.isPending && <Icons.loader aria-hidden="true" className="animate-spin" />}
              {save.isPending ? text.saving : text.save}
            </Button>
            {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
          </article>
          <article className="cosmic-panel flex flex-col gap-3 p-5">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-lg font-semibold">{text.overlay}</h2>
              <p className="text-sm text-muted-foreground">{text.overlayHelp}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={rotate.isPending}
                onClick={() => rotate.mutate()}
                type="button"
                variant="outline"
              >
                <Icons.rotateToken aria-hidden="true" />
                {config.hasOverlayToken ? text.rotate : text.createUrl}
              </Button>
              {overlayUrl && (
                <Button
                  onClick={() =>
                    void navigator.clipboard.writeText(overlayUrl).then(() => setCopied(true))
                  }
                  type="button"
                >
                  <Icons.copy aria-hidden="true" />
                  {copied ? text.copied : text.copy}
                </Button>
              )}
            </div>
            {overlayUrl && (
              <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs">{overlayUrl}</p>
            )}
            {overlayUrl && (
              <p className="text-xs text-amber-700 dark:text-amber-300">{text.tokenWarning}</p>
            )}
          </article>
        </div>
        <article className="cosmic-panel flex min-h-[520px] min-w-0 flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b border-border p-4">
            <div className="flex min-w-0 grow flex-col">
              <h2 className="font-heading text-xl font-semibold">{text.feed}</h2>
              <span className="text-xs text-muted-foreground">{urls.length}/8</span>
            </div>
            <div className="flex gap-1" aria-hidden="true">
              <span className="h-6 w-1 rounded-full bg-[#ff4057]" />
              <span className="h-6 w-1 rounded-full bg-[#9146ff]" />
            </div>
          </header>
          <ChatFeed emptyLabel={text.empty} messages={stream.messages} />
        </article>
      </div>
    </section>
  );
}
