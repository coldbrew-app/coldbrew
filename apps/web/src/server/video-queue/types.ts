import type { SharedVideo, Video } from "@coldbrew/packages/schemas.js";

export type VideoStatus = "all" | "notwatched" | "watched" | "bookmarked";
export type SharedVideoStatus = "queue" | "watched";

export type VideoPage = {
  items: Video[];
  page: number;
  pageSize: number;
  priorityCounts: Record<number, number>;
  remainingSecondsByPriorityId: Record<number, number>;
  statusCounts: Record<VideoStatus, number>;
  total: number;
  totalPages: number;
};

export type SharedVideoPage = {
  items: SharedVideo[];
  page: number;
  pageSize: number;
  priorities: Array<{
    videoPriorityId: number;
    label: string;
    videoCount: number;
    remainingSeconds: number;
  }>;
  showWatchedVideos: boolean;
  status: SharedVideoStatus;
  total: number;
  totalPages: number;
};
