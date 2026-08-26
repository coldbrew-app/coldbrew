import { erro, safeFetch } from "@lebedevna/neverthrow-utils";
import { rurl, type ReadonlyURL } from "@lebedevna/readonly-url";
import { LinkifyIt } from "linkify-it";
import { ok, safeTry } from "neverthrow";

const linkify = new LinkifyIt({ fuzzyLink: true });

function parseUrl(url: string) {
  try {
    return rurl(url.startsWith("www.") ? `https://${url}` : url);
  } catch {
    return null;
  }
}

function isYoutubeUrl(url: ReadonlyURL) {
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

function youtubeDurationSeconds(responseBody: string) {
  const lengthSeconds = responseBody.match(
    /(?:"|\\")lengthSeconds(?:"|\\")\s*:\s*(?:"|\\")(\d+)/,
  )?.[1];
  if (lengthSeconds !== undefined) return Number(lengthSeconds);

  const approxDurationMs = responseBody.match(
    /(?:"|\\")approxDurationMs(?:"|\\")\s*:\s*(?:"|\\")(\d+)/,
  )?.[1];
  return approxDurationMs === undefined ? null : Math.floor(Number(approxDurationMs) / 1000);
}

function timingFromDuration(
  parsedUrl: ReadonlyURL,
  endOfVideoSeconds: number,
  requestedTiming?: RequestedYoutubeTiming,
) {
  if (!Number.isSafeInteger(endOfVideoSeconds) || endOfVideoSeconds <= 0) {
    return erro({ type: "youtube: invalid duration", duration: endOfVideoSeconds });
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
        type: "youtube: invalid timing",
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
}

export function getYoutubeTiming(url: string, requestedTiming?: RequestedYoutubeTiming) {
  return safeTry(async function* () {
    const parsedUrl = parseUrl(url);
    if (parsedUrl === null || !isYoutubeUrl(parsedUrl)) {
      return erro({ type: "youtube: invalid url" });
    }

    return safeFetch(url).andThen((html) => {
      const endOfVideoSeconds = youtubeDurationSeconds(html);
      if (endOfVideoSeconds !== null) {
        return timingFromDuration(parsedUrl, endOfVideoSeconds, requestedTiming);
      }

      const providerVideoId = youtubeVideoId(url);
      const clientVersion = html.match(
        /(?:"|\\")INNERTUBE_CLIENT_VERSION(?:"|\\")\s*:\s*(?:"|\\")([^"\\]+)/,
      )?.[1];
      if (providerVideoId === null || clientVersion === undefined) {
        return erro({ type: "youtube: duration not found" });
      }

      return safeFetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-youtube-client-name": "1",
          "x-youtube-client-version": clientVersion,
        },
        body: JSON.stringify({
          videoId: providerVideoId,
          context: { client: { clientName: "WEB", clientVersion } },
        }),
      }).andThen((playerResponse) => {
        const playerDurationSeconds = youtubeDurationSeconds(playerResponse);
        return playerDurationSeconds === null
          ? erro({ type: "youtube: duration not found" })
          : timingFromDuration(parsedUrl, playerDurationSeconds, requestedTiming);
      });
    });
  });
}

export function extractYoutubeUrls(message: string | null) {
  const youtubeUrls = (linkify.match(message ?? "") ?? [])
    .map((match) => parseUrl(match.url))
    .filter((url): url is ReadonlyURL => url !== null && isYoutubeUrl(url))
    .map((url) => (url.protocol === "http:" ? `https:${url.href.slice(5)}` : url.href));

  return Array.from(new Set(youtubeUrls));
}
