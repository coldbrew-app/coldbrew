import type {
  ChatCapability,
  ChatMessage,
  ChatModerationCommand,
} from "@streambrew/packages/chat.js";
import { cn } from "@web/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { CosmicArt } from "./cosmic-art";
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
  overlayMessageSurface,
  capabilities,
  onModerate,
}: {
  message: ChatMessage;
  overlay: boolean;
  overlayMessageSurface: "card" | "transparent";
  capabilities: readonly ChatCapability[];
  onModerate?: (command: ChatModerationCommand) => void;
}) {
  const text = useTextWithLinks(message.text);
  return (
    <article
      className={cn(
        "group/message flex gap-3 border-l-2 py-2 pl-3",
        overlay &&
          "w-fit max-w-[min(46rem,calc(100vw-2rem))] border-l-0 rounded-xl px-3.5 py-2.5 text-white motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300",
        overlay &&
          overlayMessageSurface === "card" &&
          "bg-[#171018]/88 shadow-[0_8px_24px_rgba(15,8,14,0.28)] backdrop-blur-md",
      )}
      style={overlay ? undefined : { borderColor: providerColor[message.provider] }}
    >
      <img
        alt=""
        className={cn("mt-0.5 shrink-0", overlay ? "size-[18px]" : "size-3.5")}
        src={PlatformIcons[message.provider]}
      />
      <p
        className={cn(
          "min-w-0 leading-relaxed",
          overlay
            ? "text-[clamp(0.9375rem,1.15vw,1.125rem)] [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]"
            : "text-sm",
        )}
      >
        <strong className={cn("pr-2 font-semibold", overlay && "text-white")}>
          {message.author.displayName}
        </strong>
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
  overlayMessageSurface = "card",
  emptyLabel,
  capabilitiesForSource = () => [],
  onModerate,
}: {
  messages: ChatMessage[];
  overlay?: boolean;
  overlayMessageSurface?: "card" | "transparent";
  emptyLabel: string;
  capabilitiesForSource?: (sourceId: ChatMessage["sourceId"]) => readonly ChatCapability[];
  onModerate?: (command: ChatModerationCommand) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const didScrollToInitialMessagesRef = useRef(false);
  const [nearBottom, setNearBottom] = useState(true);
  const [unread, setUnread] = useState(0);

  const scrollToBottom = () => {
    viewportRef.current?.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setUnread(0);
  };

  useLayoutEffect(() => {
    if (messages.length === 0) return;

    if (!didScrollToInitialMessagesRef.current) {
      viewportRef.current?.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "instant",
      });
      didScrollToInitialMessagesRef.current = true;
      setUnread(0);
      return;
    }

    if (nearBottom || overlay) {
      scrollToBottom();
    } else {
      setUnread((count) => count + 1);
    }
  }, [messages.length, nearBottom, overlay]);

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <div
        aria-live={overlay ? "polite" : undefined}
        className={cn(
          "flex min-h-0 grow flex-col gap-1 overflow-y-auto",
          overlay
            ? "pointer-events-none p-[clamp(1rem,2.5vw,2rem)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "p-4",
        )}
        onScroll={(event) => {
          const target = event.currentTarget;
          setNearBottom(target.scrollHeight - target.scrollTop - target.clientHeight < 80);
        }}
        ref={viewportRef}
      >
        {messages.length === 0 && !overlay ? (
          <div className="grid grow place-items-center text-sm text-muted-foreground">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <CosmicArt variant="orbit" className="w-36 text-primary/40 opacity-65" />
              <p className="leading-relaxed">{emptyLabel}</p>
            </div>
          </div>
        ) : messages.length > 0 ? (
          <div
            className={cn(overlay ? "mt-auto flex w-full flex-col items-start gap-2" : "contents")}
          >
            {messages.map((message) => (
              <Message
                key={`${message.provider}:${message.id}`}
                message={message}
                overlay={overlay}
                overlayMessageSurface={overlayMessageSurface}
                capabilities={capabilitiesForSource(message.sourceId)}
                onModerate={onModerate}
              />
            ))}
          </div>
        ) : null}
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
