import { createFileRoute } from "@tanstack/react-router";
import { ChatFeed } from "@web/components/chat-feed";
import { useChatServiceStream } from "@web/hooks/use-chat-service-stream";
import { ChatOverlaySearchSchema } from "@web/lib/chat-overlay";
import { cn } from "@web/lib/utils";

export const Route = createFileRoute("/chat/overlay/$token")({
  component: ChatOverlay,
  validateSearch: ChatOverlaySearchSchema,
  head: () => ({
    meta: [{ title: "Chat overlay · StreamBrew" }],
    styles: [
      {
        children:
          "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent!important;background-image:none!important}",
      },
    ],
  }),
});

function ChatOverlay() {
  const { token } = Route.useParams();
  const { background } = Route.useSearch();
  const { messages } = useChatServiceStream("overlay", token);

  return (
    <main
      className={cn(
        "fixed -inset-px flex min-w-0 overflow-hidden font-sans text-white",
        background === "black"
          ? "bg-black"
          : background === "white"
            ? "bg-white"
            : "bg-transparent",
      )}
    >
      <ChatFeed
        emptyLabel="Waiting for chat…"
        messages={messages}
        overlay
        overlayMessageSurface={background === "black" ? "transparent" : "card"}
      />
    </main>
  );
}
