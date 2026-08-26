import { formatVideoTime } from "@coldbrew/packages/video-timing.js";

type SharedVideoTiming = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

export function getSharedVideoTimingParts({
  startSeconds,
  endSeconds,
  durationSeconds,
}: SharedVideoTiming) {
  return {
    startTime: startSeconds === 0 ? null : formatVideoTime(startSeconds),
    endTime: endSeconds === durationSeconds ? null : formatVideoTime(endSeconds),
  };
}
