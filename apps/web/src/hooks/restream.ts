import { useMutation, useQuery } from "@tanstack/react-query";

import { useApi } from "../lib/trpc";

export function useRestreamConfigQ() {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.restream.config.queryOptions(),
    refetchInterval: 5_000,
  });
}

export function useRestreamMutations() {
  const { queryClient, trpc } = useApi();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.restream.config.queryKey() });
  };

  return {
    createDestination: useMutation(
      trpc.restream.createDestination.mutationOptions({ onSuccess: refresh }),
    ),
    deleteDestination: useMutation(
      trpc.restream.deleteDestination.mutationOptions({ onSuccess: refresh }),
    ),
    rotateIngestKey: useMutation(
      trpc.restream.rotateIngestKey.mutationOptions({ onSuccess: refresh }),
    ),
    setDestinationEnabled: useMutation(
      trpc.restream.setDestinationEnabled.mutationOptions({ onSuccess: refresh }),
    ),
    updateDestination: useMutation(
      trpc.restream.updateDestination.mutationOptions({ onSuccess: refresh }),
    ),
  };
}
