import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { createFileRoute } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { Icons } from "@web/components/icons";
import { VideoListSkeleton } from "@web/components/loading-skeletons";
import { PagePagination } from "@web/components/page-pagination";
import VideoCard from "@web/components/video-card";
import { useEffect } from "react";
import { z } from "zod";

import { useSharedVideoPageQ } from "../hooks/api";
import { createTranslator, useI18n } from "../lib/i18n";

const SharedVideoPageDepsSchema = z.object({
  page: z.number().int().positive(),
});

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
  validateSearch: z.object({
    page: z.coerce.number().int().positive().default(1).catch(1),
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ context, deps, params }) =>
    context.queryClient.ensureQueryData(
      context.trpc.sharedVideoPage.queryOptions({
        page: SharedVideoPageDepsSchema.parse(deps).page,
        slug: params.slug,
      }),
    ),
});

function SharedVideoQueue() {
  const { slug } = Route.useParams();
  const { page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const videosQ = useSharedVideoPageQ(slug, page);
  const { t } = useI18n();

  useEffect(() => {
    if (videosQ.data && !videosQ.isPlaceholderData && videosQ.data.page !== page) {
      void navigate({ replace: true, search: { page: videosQ.data.page } });
    }
  }, [navigate, page, videosQ.data]);

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
        ) : videosQ.data?.items.length ? (
          <>
            <div className="divide-y divide-border">
              {videosQ.data.items.map((video) => (
                <VideoCard key={video.videoId} video={video} />
              ))}
            </div>
            <PagePagination
              isLoading={videosQ.isFetching}
              loadingLabel={t("loadingVideoQueue")}
              onPageChange={(nextPage) => void navigate({ search: { page: nextPage } })}
              page={videosQ.data.page}
              pageSize={videosQ.data.pageSize}
              total={videosQ.data.total}
              totalPages={videosQ.data.totalPages}
            />
          </>
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
