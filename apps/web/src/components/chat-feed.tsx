import type {
  ChatCapability,
  ChatMessage,
  ChatModerationCommand,
} from "@coldbrew/packages/chat.js";
import { cn } from "@web/lib/utils";
import { useEffect, useRef, useState } from "react";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { Icons, PlatformIcons } from "./icons";
import { Button } from "./ui/button";

const providerColor = {
  youtube: "#ff4057",
  twitch: "#9146ff",
  kick: "#53fc18",
  boosty: "#f15f2c",
  vk_video: "#2688eb",
} as const;

function Message({
  message,
  overlay,
  capabilities,
  onModerate,
}: {
  message: ChatMessage;
  overlay: boolean;
  capabilities: readonly ChatCapability[];
  onModerate?: (command: ChatModerationCommand) => void;
}) {
  const text = useTextWithLinks(message.text);
  return (
    <article
      className={cn(
        "group/message flex gap-3 border-l-2 py-2 pl-3",
        overlay && "rounded-r-xl bg-black/65 pr-3 text-white shadow-sm backdrop-blur-sm",
      )}
      style={{ borderColor: providerColor[message.provider] }}
    >
      <img alt="" className="mt-0.5 size-3.5 shrink-0" src={PlatformIcons[message.provider]} />
      <p className="min-w-0 text-sm leading-relaxed">
        <strong className="pr-2 font-semibold">{message.author.displayName}</strong>
        <span className={overlay ? "text-white/90" : "text-muted-foreground"}>
          {text.map((part, index) =>
            part.type === "url" ? (
              <a
                className="break-all underline decoration-current/40 underline-offset-2"
                href={part.href}
                key={`${part.href}-${index}`}
                rel="noreferrer noopener"
                target="_blank"
              >
                {part.text}
              </a>
            ) : (
              <span key={index}>{part.value}</span>
            ),
          )}
        </span>
      </p>
      {!overlay && onModerate && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
          {capabilities.includes("delete_message") && (
            <Button
              aria-label="Удалить сообщение"
              onClick={() =>
                onModerate({
                  type: "delete_message",
                  sourceId: message.sourceId,
                  messageId: message.id,
                })
              }
              size="icon-xs"
              title="Удалить сообщение"
              variant="ghost"
            >
              <Icons.removeSource aria-hidden="true" />
            </Button>
          )}
          {capabilities.includes("timeout_user") && (
            <Button
              aria-label="Тайм-аут на 10 минут"
              onClick={() =>
                onModerate({
                  type: "timeout_user",
                  sourceId: message.sourceId,
                  providerUserId: message.author.id,
                  durationSeconds: 600,
                })
              }
              size="icon-xs"
              title="Тайм-аут на 10 минут"
              variant="ghost"
            >
              <Icons.timeout aria-hidden="true" />
            </Button>
          )}
          {capabilities.includes("ban_user") && (
            <Button
              aria-label="Заблокировать автора"
              onClick={() =>
                onModerate({
                  type: "ban_user",
                  sourceId: message.sourceId,
                  providerUserId: message.author.id,
                })
              }
              size="icon-xs"
              title="Заблокировать автора"
              variant="destructive"
            >
              <Icons.ban aria-hidden="true" />
            </Button>
          )}
          {capabilities.includes("unban_user") && (
            <Button
              aria-label="Разблокировать автора"
              onClick={() =>
                onModerate({
                  type: "unban_user",
                  sourceId: message.sourceId,
                  providerUserId: message.author.id,
                })
              }
              size="icon-xs"
              title="Разблокировать автора"
              variant="ghost"
            >
              <Icons.unban aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function ChatFeed({
  messages,
  overlay = false,
  emptyLabel,
  capabilitiesForSource = () => [],
  onModerate,
}: {
  messages: ChatMessage[];
  overlay?: boolean;
  emptyLabel: string;
  capabilitiesForSource?: (sourceId: ChatMessage["sourceId"]) => readonly ChatCapability[];
  onModerate?: (command: ChatModerationCommand) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [unread, setUnread] = useState(0);

  const scrollToBottom = () => {
    viewportRef.current?.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setUnread(0);
  };

  useEffect(() => {
    if (nearBottom || overlay) scrollToBottom();
    else setUnread((count) => count + 1);
  }, [messages.length]);

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <div
        className={cn("flex min-h-0 grow flex-col gap-1 overflow-y-auto", overlay ? "p-3" : "p-4")}
        onScroll={(event) => {
          const target = event.currentTarget;
          setNearBottom(target.scrollHeight - target.scrollTop - target.clientHeight < 80);
        }}
        ref={viewportRef}
      >
        {messages.length === 0 ? (
          <div
            className={cn(
              "grid grow place-items-center text-sm",
              overlay ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {emptyLabel}
          </div>
        ) : (
          messages.map((message) => (
            <Message
              key={`${message.provider}:${message.id}`}
              message={message}
              overlay={overlay}
              capabilities={capabilitiesForSource(message.sourceId)}
              onModerate={onModerate}
            />
          ))
        )}
      </div>
      {!overlay && unread > 0 && (
        <Button
          className="absolute right-4 bottom-4 rounded-full shadow-lg"
          onClick={scrollToBottom}
          size="sm"
        >
          <Icons.unread aria-hidden="true" />
          {unread}
        </Button>
      )}
    </div>
  );
}
