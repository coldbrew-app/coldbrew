import type { Slug } from "@coldbrew/packages/schemas.js";
import { keepPreviousData, useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";

import { useApi } from "../lib/trpc";

export function useUserInfo() {
  const { trpc } = useApi();
  return useSuspenseQuery(trpc.userInfo.queryOptions()).data;
}

export function useSlug() {
  const userInfo = useUserInfo();

  if (!userInfo?.slug) throw new Error("not slug");
  return userInfo.slug;
}

export function useSetSlugM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateSlug.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.userInfo.queryKey() });
      },
    }),
  );
}

export function useUpdateQueueCurrencyM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateQueueCurrency.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.userInfo.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.videoPriorities.queryKey() });
      },
    }),
  );
}

export function useDisconnectM() {
  const { queryClient, trpc } = useApi();

  return useMutation(
    trpc.integration.disconnect.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.userInfo.queryKey() });
      },
    }),
  );
}

export type DonationPageInput = {
  page: number;
  period: "all" | "week" | "month";
  query: string;
};

export function useDonationPageQ(input: DonationPageInput) {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.donationPage.queryOptions(input),
    placeholderData: keepPreviousData,
  });
}

export function useDonationOverviewQ() {
  const { trpc } = useApi();
  return useQuery(trpc.donationOverview.queryOptions());
}

export type VideoPageInput = {
  page: number;
  videoPriorityId: number | null;
  videoStatus: "all" | "notwatched" | "watched" | "saved";
};

export function useVideoPageQ(input: VideoPageInput) {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.videoPage.queryOptions(input),
    placeholderData: keepPreviousData,
  });
}

export function useAddVideoM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.addVideo.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() });
      },
    }),
  );
}

export function useVideoPrioritiesQ() {
  const { trpc } = useApi();
  return useQuery(trpc.videoPriorities.queryOptions());
}

export function useUpdateVideoPriorityM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateVideoPriority.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.videoPriorities.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() });
      },
    }),
  );
}

export function useUpdateVideoStatusM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateVideoStatus.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() });
      },
    }),
  );
}

export function useUpdateVideoM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateVideo.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() });
      },
    }),
  );
}

export function useSharedVideoPageQ(slug: Slug, page: number) {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.sharedVideoPage.queryOptions({ page, slug }),
    placeholderData: keepPreviousData,
  });
}

export function useAuthUrlQ(enabled = true) {
  const { trpc } = useApi();
  return useQuery({ ...trpc.authUrls.queryOptions(), enabled });
}
