import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { createFileRoute } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import VideoCard from "@web/components/video-card";
import { z } from "zod";

import { useSharedVideosQ } from "../hooks/api";
import { createTranslator, useI18n } from "../lib/i18n";

export const Route = createFileRoute("/share/$slug")({
  component: SharedVideoQueue,
  head: ({ match, params }) => ({
    meta: [
      {
        title: `${createTranslator(match.context.locale)("videoQueueBy", { slug: params.slug })} · Coldbrew`,
      },
    ],
  }),
  params: z.object({
    slug: SlugSchema,
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      context.trpc.sharedVideos.queryOptions({ slug: params.slug }),
    ),
});

function SharedVideoQueue() {
  const { slug } = Route.useParams();
  const videosQ = useSharedVideosQ(slug);
  const { t } = useI18n();

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foreground sm:p-8">
      <div className="cosmic-grid pointer-events-none absolute inset-0 opacity-35" />
      <section className="cosmic-panel relative mx-auto w-full max-w-4xl overflow-hidden">
        <header className="cosmic-hero relative flex min-h-48 flex-col justify-center gap-2 overflow-hidden p-5 text-white sm:p-8">
          <span className="relative z-10 text-[10px] font-bold tracking-[0.18em] text-[#ffcf69] uppercase">
            {t("publicQueueEyebrow")}
          </span>
          <h1 className="relative z-10 max-w-xl font-heading text-[clamp(28px,5vw,44px)] leading-none font-semibold">
            {t("videoQueueBy", { slug })}
          </h1>
          <p className="relative z-10 max-w-md text-xs leading-relaxed text-white/70">
            {t("videosSharedBySupporters")}
          </p>
          <CosmicArt
            className="pointer-events-none absolute -right-6 -bottom-12 w-72"
            variant="orbit"
          />
        </header>
        {videosQ.isLoading ? (
          <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} />
        ) : videosQ.data?.length ? (
          <div className="divide-y divide-border">
            {videosQ.data.map((video) => (
              <VideoCard key={video.videoId} video={video} />
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center px-5 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                <Icons.wallet aria-hidden="true" size={20} />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-card-foreground">
                {t(videosQ.data === null ? "queueNotFound" : "noVideosInQueue")}
              </h2>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
                {videosQ.data === null ? t("sharedQueueUnavailable") : t("videoLinksWillAppear")}
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
