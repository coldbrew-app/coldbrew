import { erro, safeFetch } from "@lebedevna/neverthrow-utils";
import { LinkifyIt } from "linkify-it";
import { errAsync, ok } from "neverthrow";

const linkify = new LinkifyIt({ fuzzyLink: true });

function parseUrl(url: string) {
  try {
    return new URL(url.startsWith("www.") ? `https://${url}` : url);
  } catch {
    return null;
  }
}

function isYoutubeUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

export function parseYoutubeTimestamp(value: string | null) {
  if (value === null) return null;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }

  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (match === null || match[0] === "") return null;

  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  const totalSeconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isSafeInteger(totalSeconds) ? totalSeconds : null;
}

type RequestedYoutubeTiming = {
  startSeconds: number;
  endSeconds: number | null;
};

export function getYoutubeTiming(url: string, requestedTiming?: RequestedYoutubeTiming) {
  const parsedUrl = parseUrl(url);
  if (parsedUrl === null || !isYoutubeUrl(parsedUrl)) {
    return errAsync({ type: "youtube: invalid url" as const });
  }

  return safeFetch(url).andThen((html) => {
    const duration = html.match(/"lengthSeconds":"(\d+)"/)?.[1];
    if (duration === undefined) {
      return erro({ type: "youtube: duration not found" as const });
    }

    const endOfVideoSeconds = Number(duration);
    if (!Number.isSafeInteger(endOfVideoSeconds) || endOfVideoSeconds <= 0) {
      return erro({ type: "youtube: invalid duration" as const, duration: endOfVideoSeconds });
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
        return erro({
          type: "youtube: invalid timing" as const,
          startSeconds,
          endSeconds,
          endOfVideoSeconds,
        });
      }

      return ok({ startSeconds, endSeconds });
    }

    const startSeconds = 0;
    const requestedEndSeconds = parseYoutubeTimestamp(parsedUrl.searchParams.get("end"));
    const endSeconds =
      requestedEndSeconds !== null &&
      requestedEndSeconds > startSeconds &&
      requestedEndSeconds <= endOfVideoSeconds
        ? requestedEndSeconds
        : endOfVideoSeconds;

    return ok({ startSeconds, endSeconds });
  });
}

export function extractYoutubeUrls(message: string | null) {
  const youtubeUrls = (linkify.match(message ?? "") ?? [])
    .map((match) => parseUrl(match.url))
    .filter((url): url is URL => url !== null && isYoutubeUrl(url))
    .map((url) => (url.protocol === "http:" ? `https:${url.href.slice(5)}` : url.href));

  return Array.from(new Set(youtubeUrls));
}

export function youtubeVideoId(url: string) {
  const parsedUrl = parseUrl(url);
  if (parsedUrl === null || !isYoutubeUrl(parsedUrl)) return null;

  const host = parsedUrl.hostname.toLowerCase();
  const id =
    host === "youtu.be"
      ? parsedUrl.pathname.split("/")[1]
      : (parsedUrl.searchParams.get("v") ??
        parsedUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);
  return id || null;
}
