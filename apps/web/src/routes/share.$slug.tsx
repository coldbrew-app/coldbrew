import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { createFileRoute } from "@tanstack/react-router";
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
    <main className="min-h-dvh bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foreground sm:p-8">
      <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm shadow-primary/5">
        <header className="flex flex-col gap-1 border-b border-border p-5">
          <h1 className="font-heading text-xl font-semibold text-card-foreground">
            {t("videoQueueBy", { slug })}
          </h1>
          <p className="text-xs text-muted-foreground">{t("videosSharedBySupporters")}</p>
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
