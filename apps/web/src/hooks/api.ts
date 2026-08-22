import type { Slug } from "@coldbrew/packages/schemas.js";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";

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

export function useDonationsQ() {
  const { trpc } = useApi();
  return useQuery(trpc.donations.queryOptions());
}

export function useVideosQ() {
  const { trpc } = useApi();
  return useQuery(trpc.videos.queryOptions());
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
        queryClient.invalidateQueries({ queryKey: trpc.videos.queryKey() });
      },
    }),
  );
}

export function useUpdateVideoStatusM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateVideoStatus.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.videos.queryKey() });
      },
    }),
  );
}

export function useUpdateVideoM() {
  const { queryClient, trpc } = useApi();
  return useMutation(
    trpc.updateVideo.mutationOptions({
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: trpc.videos.queryKey() });
      },
    }),
  );
}

export function useSharedVideosQ(slug: Slug) {
  const { trpc } = useApi();
  return useQuery(trpc.sharedVideos.queryOptions({ slug }));
}

export function useAuthUrlQ(enabled = true) {
  const { trpc } = useApi();
  return useQuery({ ...trpc.authUrls.queryOptions(), enabled });
}
