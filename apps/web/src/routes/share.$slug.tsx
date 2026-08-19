import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { createFileRoute } from "@tanstack/react-router";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import VideoCard from "@web/components/video-card";
import { z } from "zod";

import { useSharedVideosQ } from "../hooks/api";
import { useI18n } from "../lib/i18n";

export const Route = createFileRoute("/share/$slug")({
  component: SharedVideoQueue,
  params: z.object({
    slug: SlugSchema,
  }),
});

function SharedVideoQueue() {
  const { slug } = Route.useParams();
  const videosQ = useSharedVideosQ(slug);
  const { t } = useI18n();

  return (
    <main className="min-h-dvh bg-[#f7f7fb] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-[#242238] sm:p-8">
      <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-xl border border-[#eae8ef] bg-white shadow-sm">
        <header className="flex flex-col gap-1 border-b border-[#efedf3] p-5">
          <h1 className="text-lg font-semibold text-[#353248]">{t("videoQueueBy", { slug })}</h1>
          <p className="text-xs text-[#9491a1]">{t("videosSharedBySupporters")}</p>
        </header>
        {videosQ.isLoading ? (
          <VideoListSkeleton aria-busy="true" aria-label={t("loadingVideoQueue")} />
        ) : videosQ.data?.length ? (
          <div className="divide-y divide-[#f0eff3]">
            {videosQ.data.map((video) => (
              <VideoCard key={video.videoId} video={video} />
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center px-5 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-xl bg-violet-100 text-violet-600">
                <Icons.wallet aria-hidden="true" size={20} />
              </div>
              <h2 className="mt-4 text-sm font-semibold text-[#4c485b]">
                {t(videosQ.data === null ? "queueNotFound" : "noVideosInQueue")}
              </h2>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#908d9d]">
                {videosQ.data === null ? t("sharedQueueUnavailable") : t("videoLinksWillAppear")}
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
