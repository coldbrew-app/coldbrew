export function groupVideosByPriority<Video extends { videoPriorityId: number | null }>(
  videos: readonly Video[],
) {
  const priorityIds = [
    ...new Set(
      videos.flatMap((video) => (video.videoPriorityId === null ? [] : [video.videoPriorityId])),
    ),
  ];

  return {
    groups: priorityIds.map((videoPriorityId) => ({
      videoPriorityId,
      videos: videos.filter((video) => video.videoPriorityId === videoPriorityId),
    })),
    unassignedVideos: videos.filter((video) => video.videoPriorityId === null),
  };
}
