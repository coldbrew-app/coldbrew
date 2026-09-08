import { formatVideoTime } from "@coldbrew/packages/video-timing.js";

type SharedVideoTiming = {
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number | null;
};

export function getSharedVideoTimingParts({
  startSeconds,
  endSeconds,
  durationSeconds,
}: SharedVideoTiming) {
  return {
    startTime: startSeconds === 0 ? null : formatVideoTime(startSeconds),
    endTime:
      endSeconds === null || endSeconds === durationSeconds ? null : formatVideoTime(endSeconds),
  };
}
