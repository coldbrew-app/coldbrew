import { parseYoutubeTimestamp, youtubeVideoId } from "@coldbrew/packages/youtube.js";
import { rurl, type ReadonlyURL } from "@lebedevna/readonly-url";
import { Innertube } from "youtubei.js";
import { z } from "zod";

export type RequestedYoutubeTiming = {
  startSeconds: number;
  endSeconds: number | null;
};

export type YoutubeTimingErrorType =
  | "youtube: invalid url"
  | "youtube: invalid duration"
  | "youtube: invalid timing"
  | "youtube: duration not found"
  | "youtube: request failed";

export class YoutubeTimingError extends Error {
  readonly type: YoutubeTimingErrorType;
  readonly details?: Readonly<Record<string, number>>;

  constructor(
    type: YoutubeTimingErrorType,
    details?: Readonly<Record<string, number>>,
    options?: ErrorOptions,
  ) {
    super(type, options);
    this.name = "YoutubeTimingError";
    this.type = type;
    this.details = details;
  }
}

export type YoutubeTiming = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

let youtubeClientPromise: Promise<Innertube> | undefined;

function youtubeClient() {
  youtubeClientPromise ??= Innertube.create();
  return youtubeClientPromise;
}

function parseUrl(url: string) {
  try {
    return rurl(url.startsWith("www.") ? `https://${url}` : url);
  } catch {
    return null;
  }
}

function timingFromDuration(
  parsedUrl: ReadonlyURL,
  endOfVideoSeconds: number,
  requestedTiming?: RequestedYoutubeTiming,
) {
  if (!Number.isSafeInteger(endOfVideoSeconds) || endOfVideoSeconds <= 0) {
    throw new YoutubeTimingError("youtube: invalid duration", {
      duration: endOfVideoSeconds,
    });
  }

  if (requestedTiming !== undefined) {
    const startSeconds = requestedTiming.startSeconds;
    const endSeconds = requestedTiming.endSeconds ?? endOfVideoSeconds;
    if (
      !Number.isSafeInteger(startSeconds) ||
      startSeconds < 0 ||
      !Number.isSafeInteger(endSeconds) ||
      endSeconds <= startSeconds ||
      endSeconds > endOfVideoSeconds
    ) {
      throw new YoutubeTimingError("youtube: invalid timing", {
        startSeconds,
        endSeconds,
        endOfVideoSeconds,
      });
    }

    return { startSeconds, endSeconds, durationSeconds: endOfVideoSeconds };
  }

  const startSeconds = 0;
  const requestedEndSeconds = parseYoutubeTimestamp(parsedUrl.searchParams.get("end"));
  const endSeconds =
    requestedEndSeconds !== null &&
    requestedEndSeconds > startSeconds &&
    requestedEndSeconds <= endOfVideoSeconds
      ? requestedEndSeconds
      : endOfVideoSeconds;

  return { startSeconds, endSeconds, durationSeconds: endOfVideoSeconds };
}

export async function getYoutubeTiming(url: string, requestedTiming?: RequestedYoutubeTiming) {
  const parsedUrl = parseUrl(url);
  const providerVideoId = youtubeVideoId(url);
  if (parsedUrl === null || providerVideoId === null) {
    throw new YoutubeTimingError("youtube: invalid url");
  }

  let info: unknown;
  try {
    info = await (await youtubeClient()).getBasicInfo(providerVideoId);
  } catch (cause) {
    throw new YoutubeTimingError("youtube: request failed", undefined, {
      cause,
    });
  }

  const schema = z.object({
    basic_info: z.object({
      duration: z.unknown().optional(),
    }),
  });
  const parsedInfo = schema.safeParse(info);
  if (!parsedInfo.success || parsedInfo.data.basic_info.duration === undefined) {
    throw new YoutubeTimingError("youtube: duration not found", undefined, {
      cause: parsedInfo.success ? undefined : parsedInfo.error,
    });
  }

  const durationSchema = z.int().positive();
  const parsedDuration = durationSchema.safeParse(parsedInfo.data.basic_info.duration);
  if (!parsedDuration.success) {
    throw new YoutubeTimingError("youtube: invalid duration", undefined, {
      cause: parsedDuration.error,
    });
  }

  return timingFromDuration(parsedUrl, parsedDuration.data, requestedTiming);
}
