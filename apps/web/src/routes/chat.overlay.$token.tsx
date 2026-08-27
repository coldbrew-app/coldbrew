import { createFileRoute } from "@tanstack/react-router";
import { ChatFeed } from "@web/components/chat-feed";
import { useChatStream } from "@web/hooks/use-chat-stream";
import { useEffect } from "react";

export const Route = createFileRoute("/chat/overlay/$token")({
  component: ChatOverlay,
  head: () => ({ meta: [{ title: "Chat overlay · Coldbrew" }] }),
});

function ChatOverlay() {
  const { token } = Route.useParams();
  const { connectionError, messages } = useChatStream("overlay", token);

  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = previous;
    };
  }, []);

  return (
    <main className="flex h-dvh min-w-0 bg-transparent font-sans text-white">
      <ChatFeed
        emptyLabel={connectionError?.detail ?? "Waiting for chat…"}
        messages={messages}
        overlay
      />
    </main>
  );
}
