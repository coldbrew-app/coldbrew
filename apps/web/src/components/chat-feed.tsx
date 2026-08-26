import type { ChatMessage } from "@web/lib/chat";
import { cn } from "@web/lib/utils";
import { useEffect, useRef, useState } from "react";

import { useTextWithLinks } from "../hooks/use-text-with-links";
import { Icons } from "./icons";
import { Button } from "./ui/button";

function Message({ message, overlay }: { message: ChatMessage; overlay: boolean }) {
  const text = useTextWithLinks(message.text);
  return (
    <article
      className={cn(
        "flex gap-3 border-l-2 py-2 pl-3",
        message.provider === "youtube" ? "border-[#ff4057]" : "border-[#9146ff]",
        overlay && "rounded-r-xl bg-black/65 pr-3 text-white shadow-sm backdrop-blur-sm",
      )}
    >
      <span
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          message.provider === "youtube" ? "bg-[#ff4057]" : "bg-[#9146ff]",
        )}
        aria-hidden="true"
      />
      <p className="min-w-0 text-sm leading-relaxed">
        <strong className="pr-2 font-semibold">{message.author}</strong>
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
    </article>
  );
}

export function ChatFeed({
  messages,
  overlay = false,
  emptyLabel,
}: {
  messages: ChatMessage[];
  overlay?: boolean;
  emptyLabel: string;
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
