import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChatFeed } from "@web/components/chat-feed";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import { Icons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Label } from "@web/components/ui/label";
import { useChatStream } from "@web/hooks/use-chat-stream";
import { chatSourceKey, MAX_CHAT_SOURCES } from "@web/lib/chat";
import { initialChatEditorState, reduceChatEditorState } from "@web/lib/chat-state";
import { useI18n } from "@web/lib/i18n";
import { preloadRouteQuery, useApi } from "@web/lib/trpc";
import { useEffect, useReducer, type ChangeEvent, type KeyboardEvent } from "react";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
  head: ({ match }) => ({
    meta: [{ title: `${match.context.locale === "ru" ? "Мультичат" : "Multichat"} · Coldbrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await preloadRouteQuery(context.queryClient, context.trpc.chat.config.queryOptions());
  },
});

const copy = {
  en: {
    eyebrow: "YouTube chats, one current",
    description: "Combine public YouTube live chats without connecting a platform account.",
    sources: "Chat sources",
    sourceHelp: "Add up to 8 YouTube live links.",
    sourceLabel: "YouTube live URL",
    placeholder: "https://youtube.com/watch?v=…",
    add: "Add source",
    save: "Save sources",
    saving: "Saving…",
    invalid: "This link is not a supported YouTube live URL.",
    duplicate: "This source is already in the list.",
    limit: "You can add at most 8 chat sources.",
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
    loading: "Loading chat…",
    retry: "Retry",
  },
  ru: {
    eyebrow: "Все чаты в одном окне",
    description:
      "Соберите чаты нескольких трансляций YouTube в одной ленте. Подключать аккаунт не нужно.",
    sources: "Трансляции",
    sourceHelp: "Добавьте до 8 ссылок на трансляции YouTube.",
    sourceLabel: "Ссылка на трансляцию YouTube",
    placeholder: "https://youtube.com/watch?v=…",
    add: "Добавить",
    save: "Сохранить",
    saving: "Сохраняем…",
    invalid: "Эта ссылка не ведёт на трансляцию YouTube.",
    duplicate: "Эта трансляция уже добавлена.",
    limit: "Можно добавить не более 8 трансляций.",
    feed: "Все сообщения",
    empty: "Сообщения появятся, когда начнётся хотя бы одна из добавленных трансляций.",
    overlay: "Чат в OBS",
    overlayHelp:
      "Эта ссылка открывает чат в OBS без входа в Coldbrew. После обновления старая ссылка перестанет работать.",
    createUrl: "Создать ссылку для OBS",
    rotate: "Обновить ссылку",
    copy: "Скопировать ссылку",
    copied: "Скопировано",
    tokenWarning:
      "Скопируйте ссылку сейчас: после закрытия страницы показать её снова не получится.",
    remove: "Удалить трансляцию",
    loading: "Загружаем чат…",
    retry: "Повторить",
  },
} as const;

function ChatPage() {
  const { locale } = useI18n();
  const text = copy[locale];
  const { queryClient, trpc } = useApi();
  const configQuery = useQuery(trpc.chat.config.queryOptions());
  const config = configQuery.data;
  const [editor, dispatch] = useReducer(reduceChatEditorState, initialChatEditorState);
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
        dispatch({ type: "overlay rotated", overlayUrl: result.overlayUrl });
        queryClient.invalidateQueries({ queryKey: trpc.chat.config.queryKey() });
      },
    }),
  );

  useEffect(() => {
    if (config) {
      dispatch({ type: "config loaded", sources: config.sources });
    }
  }, [config]);

  const addSource = () => dispatch({ type: "source added" });
  const onInputChange = (event: ChangeEvent<HTMLInputElement>) =>
    dispatch({ type: "input changed", input: event.target.value });
  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addSource();
  };
  const copyOverlayUrl = async () => {
    if (!editor.overlayUrl) return;
    await navigator.clipboard.writeText(editor.overlayUrl);
    dispatch({ type: "overlay copied" });
  };

  if (!config) {
    return (
      <section className="flex min-h-full flex-col gap-4">
        <CosmicPageHeader
          description={text.description}
          eyebrow={text.eyebrow}
          title={locale === "ru" ? "Мультичат" : "Multichat"}
        />
        <div
          aria-busy={!configQuery.isError}
          className="cosmic-panel flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center"
        >
          {configQuery.isError ? (
            <>
              <p className="text-sm text-destructive">{configQuery.error.message}</p>
              <Button onClick={() => void configQuery.refetch()} variant="outline">
                <Icons.retry aria-hidden="true" />
                {text.retry}
              </Button>
            </>
          ) : (
            <>
              <Icons.loader aria-hidden="true" className="animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{text.loading}</p>
            </>
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
              <Label htmlFor="chat-source">{text.sourceLabel}</Label>
              <div className="flex gap-2">
                <Input
                  aria-invalid={Boolean(editor.inputError)}
                  id="chat-source"
                  onChange={onInputChange}
                  onKeyDown={onInputKeyDown}
                  placeholder={text.placeholder}
                  value={editor.input}
                />
                <Button
                  disabled={editor.sources.length >= MAX_CHAT_SOURCES}
                  onClick={addSource}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Icons.addSource aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{text.add}</span>
                </Button>
              </div>
              {editor.inputError && (
                <p className="text-xs text-destructive">
                  {editor.inputError === "unsupported"
                    ? text.invalid
                    : editor.inputError === "duplicate"
                      ? text.duplicate
                      : text.limit}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {editor.sources.map((source, index) => {
                const state = stream.statuses[chatSourceKey(source)];
                return (
                  <div
                    className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/35 p-2"
                    key={chatSourceKey(source)}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${state === "live" ? "bg-emerald-500" : state === "error" ? "bg-destructive" : "bg-muted-foreground/40"}`}
                    />
                    <span className="min-w-0 grow truncate text-sm">{source.sourceUrl}</span>
                    <Button
                      aria-label={text.remove}
                      onClick={() => dispatch({ type: "source removed", index })}
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
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ sourceUrls: editor.sources.map((source) => source.sourceUrl) })
              }
              type="button"
            >
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
              {editor.overlayUrl && (
                <Button onClick={() => void copyOverlayUrl()} type="button">
                  <Icons.copy aria-hidden="true" />
                  {editor.copied ? text.copied : text.copy}
                </Button>
              )}
            </div>
            {editor.overlayUrl && (
              <p className="break-all rounded-lg bg-muted p-3 font-mono text-xs">
                {editor.overlayUrl}
              </p>
            )}
            {editor.overlayUrl && (
              <p className="text-xs text-amber-700 dark:text-amber-300">{text.tokenWarning}</p>
            )}
          </article>
        </div>
        <article className="cosmic-panel flex min-h-[520px] min-w-0 flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b border-border p-4">
            <div className="flex min-w-0 grow flex-col">
              <h2 className="font-heading text-xl font-semibold">{text.feed}</h2>
              <span className="text-xs text-muted-foreground">
                {editor.sources.length}/{MAX_CHAT_SOURCES}
              </span>
            </div>
            <div className="flex gap-1" aria-hidden="true">
              <span className="h-6 w-1 rounded-full bg-[#ff4057]" />
            </div>
          </header>
          <ChatFeed
            emptyLabel={stream.connectionError?.detail ?? text.empty}
            messages={stream.messages}
          />
        </article>
      </div>
    </section>
  );
}
