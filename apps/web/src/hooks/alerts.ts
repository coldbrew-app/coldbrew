import { useMutation, useQuery } from "@tanstack/react-query";
import { useApi } from "@web/lib/trpc";

export function useAlertDashboard() {
  const { trpc } = useApi();
  return useQuery({
    ...trpc.alerts.dashboard.queryOptions(),
    refetchInterval: 5_000,
  });
}

export function useAlertMutations() {
  const { queryClient, trpc } = useApi();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.alerts.dashboard.queryKey() });
  const settings = useMutation(trpc.alerts.updateSettings.mutationOptions({ onSuccess: refresh }));
  const rotateToken = useMutation(
    trpc.alerts.rotateOverlayToken.mutationOptions({ onSuccess: refresh }),
  );
  const test = useMutation(trpc.alerts.test.mutationOptions({ onSuccess: refresh }));
  const paused = useMutation(trpc.alerts.setPaused.mutationOptions({ onSuccess: refresh }));
  const skip = useMutation(trpc.alerts.skip.mutationOptions({ onSuccess: refresh }));
  const replay = useMutation(trpc.alerts.replay.mutationOptions({ onSuccess: refresh }));
  const deleteAsset = useMutation(trpc.alerts.deleteAsset.mutationOptions({ onSuccess: refresh }));

  return { deleteAsset, paused, refresh, replay, rotateToken, settings, skip, test };
}
