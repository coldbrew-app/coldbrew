import type { Slug } from "@coldbrew/packages/schemas.js";
import { keepPreviousData, useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";

import { useApi } from "../lib/trpc";

export function useUserInfoSafe() {
  const { trpc } = useApi();
  return useSuspenseQuery(trpc.userInfo.queryOptions()).data;
}

export function useUserInfo() {
  const userInfo = useUserInfoSafe();

  if (userInfo === null) {
    throw new Error("Authenticated user info is required.");
  }
  return userInfo;
}

export function useSetSlugM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateSlug.mutationOptions({
      async onSuccess() {
        await queryClient.invalidateQueries({ queryKey: trpc.userInfo.queryKey() });
      },
    }),
  );
}

export function useUpdateQueueCurrencyM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateQueueCurrency.mutationOptions({
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.userInfo.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.donationPage.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.videoPriorities.queryKey() }),
        ]);
      },
    }),
  );
}

export function useUpdatePublicQueueSettingsM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updatePublicQueueSettings.mutationOptions({
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.userInfo.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.sharedVideoPage.queryKey() }),
        ]);
      },
    }),
  );
}

export function useDisconnectM() {
  const { queryClient, trpc } = useApi();

  return useMutation(
    trpc.integration.disconnect.mutationOptions({
      async onSuccess() {
        await queryClient.invalidateQueries({ queryKey: trpc.userInfo.queryKey() });
      },
    }),
  );
}

export type DonationPageInput = {
  donationId?: string;
  page: number;
  period: "all" | "week" | "month";
  query: string;
};

export function useDonationPageQ(input: DonationPageInput) {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.donationPage.queryOptions(input),
    placeholderData: input.donationId ? undefined : keepPreviousData,
  });
}

export function useDonationOverviewQ() {
  const { trpc } = useApi();
  return useQuery(trpc.donationOverview.queryOptions());
}

export type VideoPageInput = {
  videoId?: string;
  page: number;
  videoPriorityId: number | null;
  videoStatus: "all" | "notwatched" | "watched" | "bookmarked";
};

export function useVideoPageQ(input: VideoPageInput) {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.videoPage.queryOptions(input),
    placeholderData: input.videoId ? undefined : keepPreviousData,
  });
}

export function useAddVideoM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.addVideo.mutationOptions({
      async onSuccess() {
        await queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() });
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
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.videoPriorities.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.donationPage.queryKey() }),
        ]);
      },
    }),
  );
}

export function useUpdateVideoStatusM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateVideoStatus.mutationOptions({
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.donationPage.queryKey() }),
        ]);
      },
    }),
  );
}

export function useUpdateVideoM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateVideo.mutationOptions({
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.videoPage.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.donationPage.queryKey() }),
        ]);
      },
    }),
  );
}

export function useSharedVideoPageQ(slug: Slug, page: number, status: "queue" | "watched") {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.sharedVideoPage.queryOptions({ page, slug, status }),
    placeholderData: keepPreviousData,
  });
}

export function useAuthUrlQ(enabled = true) {
  const { trpc } = useApi();
  return useQuery({ ...trpc.authUrls.queryOptions(), enabled });
}

export function useChatDeadLettersQ(beforeSequence?: string) {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.chat.deadLetters.queryOptions({ beforeSequence }),
    placeholderData: keepPreviousData,
  });
}
