import type { Slug } from "@omnistream/packages/schemas.js";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { trpc } from "../lib/trpc";

export function useUserInfo() {
  return useSuspenseQuery(trpc.userInfo.queryOptions()).data;
}

export function useSlug() {
  const slug = useSuspenseQuery(
    trpc.userInfo.queryOptions(undefined, { select: (data) => data?.slug }),
  );

  if (!slug.data) throw new Error("not slug");
  return slug.data;
}

export function useSetSlugM() {
  const client = useQueryClient();
  return useMutation(
    trpc.updateSlug.mutationOptions({
      onSuccess() {
        client.invalidateQueries({ queryKey: trpc.userInfo.queryKey() });
      },
    }),
  );
}

export function useDisconnectM() {
  const client = useQueryClient();

  return useMutation(
    trpc.integration.disconnect.mutationOptions({
      onSuccess() {
        client.invalidateQueries({ queryKey: trpc.userInfo.queryKey() });
      },
    }),
  );
}

export function useDonationsQ() {
  return useQuery(trpc.donations.queryOptions());
}

export function useVideosQ() {
  return useQuery(trpc.videos.queryOptions());
}

export function useVideoPrioritiesQ() {
  return useQuery(trpc.videoPriorities.queryOptions());
}

export function useUpdateVideoPriorityM() {
  const client = useQueryClient();
  return useMutation(
    trpc.updateVideoPriority.mutationOptions({
      onSuccess() {
        client.invalidateQueries({ queryKey: trpc.videoPriorities.queryKey() });
        client.invalidateQueries({ queryKey: trpc.videos.queryKey() });
      },
    }),
  );
}

export function useUpdateVideoStatusM() {
  const client = useQueryClient();
  return useMutation(
    trpc.updateVideoStatus.mutationOptions({
      onSuccess() {
        client.invalidateQueries({ queryKey: trpc.videos.queryKey() });
      },
    }),
  );
}

export function useUpdateVideoAmountM() {
  const client = useQueryClient();
  return useMutation(
    trpc.updateVideoAmount.mutationOptions({
      onSuccess() {
        client.invalidateQueries({ queryKey: trpc.videos.queryKey() });
      },
    }),
  );
}

export function useSharedVideosQ(slug: Slug) {
  return useQuery(trpc.sharedVideos.queryOptions({ slug }));
}

export function useAuthUrl() {
  return useSuspenseQuery(trpc.authUrls.queryOptions()).data;
}
