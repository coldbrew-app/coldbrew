import type { AlertPlayback } from "@coldbrew/packages/alerts.js";
import { fmtAmount } from "@web/lib/fmt";
import { createI18n, useI18n } from "@web/lib/i18n";
import { cn } from "@web/lib/utils";

const i18n = createI18n({
  anonymous: { en: "Anonymous", ru: "Аноним" },
  supported: { en: "sent", ru: "отправил(а)" },
  testMessage: {
    en: "Your donation message will appear here.",
    ru: "Здесь появится сообщение к донату.",
  },
});

export function AlertCard({
  className,
  imageSrc,
  playback,
  stage = "shown",
}: {
  className?: string;
  imageSrc?: string | null;
  playback: AlertPlayback;
  stage?: "entering" | "exiting" | "hidden" | "shown";
}) {
  const { locale, t } = useI18n(i18n);
  const author = playback.author?.trim() || t("anonymous");
  const message = playback.message?.trim() || (playback.kind === "test" ? t("testMessage") : "");

  return (
    <article
      aria-hidden={stage === "hidden"}
      className={cn(
        "alert-card relative flex w-[min(92%,42rem)] items-center gap-5 overflow-hidden rounded-[1.5rem] border border-white/15 bg-[#251820]/95 p-5 text-[#fff8ed] shadow-[0_20px_60px_rgba(20,9,17,0.4)]",
        stage === "entering" && "alert-card-entering",
        stage === "exiting" && "alert-card-exiting",
        stage === "hidden" && "pointer-events-none opacity-0",
        className,
      )}
      style={{ "--alert-accent": playback.accentColor } as React.CSSProperties}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1.5 bg-[var(--alert-accent)]"
      />
      <div className="relative grid size-28 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/7 sm:size-36">
        {imageSrc ? (
          <img alt="" className="size-full object-contain" src={imageSrc} />
        ) : (
          <span
            aria-hidden="true"
            className="alert-signal grid size-16 place-items-center rounded-full"
          >
            <span className="size-5 rotate-45 rounded-sm bg-[var(--alert-accent)]" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm text-[#d9cbd4]">{t("supported")}</p>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <strong className="font-heading line-clamp-2 min-w-0 max-w-full text-2xl leading-none font-semibold text-white [overflow-wrap:anywhere] sm:text-3xl">
            {author}
          </strong>
          <span className="font-heading text-xl font-semibold text-[var(--alert-accent)] sm:text-2xl">
            {fmtAmount(playback.amount, playback.currency, locale)}
          </span>
        </div>
        {message && (
          <p className="line-clamp-3 text-base leading-relaxed text-[#fff8ed]/90 [overflow-wrap:anywhere] sm:text-lg">
            {message}
          </p>
        )}
      </div>
    </article>
  );
}
