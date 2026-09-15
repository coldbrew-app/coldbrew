import { AlertOverlayTokenSchema } from "@streambrew/packages/alerts.js";
import { createFileRoute } from "@tanstack/react-router";
import { AlertPlayer } from "@web/components/alert-player";
import { useAlertOverlay } from "@web/hooks/use-alert-overlay";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/alerts/overlay")({
  component: AlertOverlay,
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  }),
  head: () => ({
    meta: [
      { title: "StreamBrew" },
      { content: "no-referrer", name: "referrer" },
      { content: "noindex, nofollow", name: "robots" },
    ],
  }),
});

function AlertOverlay() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const readToken = () => {
      const result = AlertOverlayTokenSchema.safeParse(window.location.hash.slice(1));
      setToken(result.success ? result.data : null);
    };
    readToken();
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);

  return (
    <main className="alert-overlay-root size-full overflow-hidden bg-transparent">
      {token === null ? null : <ConnectedAlertOverlay token={token} />}
    </main>
  );
}

function ConnectedAlertOverlay({ token }: { token: string }) {
  const overlay = useAlertOverlay(token);
  return (
    <AlertPlayer
      active={overlay.active}
      interruptionKey={overlay.interruptionKey}
      onDiagnostic={overlay.onDiagnostic}
      onFinished={overlay.onFinished}
      onStarted={overlay.onStarted}
      playback={overlay.playback}
      token={token}
    />
  );
}
