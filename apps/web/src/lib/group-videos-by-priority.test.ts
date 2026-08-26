import { describe, expect, it } from "vitest";

import { groupVideosByPriority } from "./group-videos-by-priority.js";

describe("groupVideosByPriority", () => {
  it("keeps priority and video order while separating unassigned videos", () => {
    const videos = [
      { videoId: 1, videoPriorityId: 3 },
      { videoId: 2, videoPriorityId: 3 },
      { videoId: 3, videoPriorityId: 1 },
      { videoId: 4, videoPriorityId: null },
    ];

    expect(groupVideosByPriority(videos)).toEqual({
      groups: [
        { videoPriorityId: 3, videos: videos.slice(0, 2) },
        { videoPriorityId: 1, videos: videos.slice(2, 3) },
      ],
      unassignedVideos: videos.slice(3),
    });
  });
});
