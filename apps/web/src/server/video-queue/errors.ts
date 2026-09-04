export type VideoQueueErrorType =
  | "invalid youtube url"
  | "youtube timing unavailable"
  | "video not found"
  | "video priority not found";

export class VideoQueueError extends Error {
  constructor(
    readonly type: VideoQueueErrorType,
    options?: ErrorOptions,
  ) {
    super(type, options);
    this.name = "VideoQueueError";
  }
}
