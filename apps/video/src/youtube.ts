import { safeFetch } from "@lebedevna/neverthrow-utils";
import { erro } from "@lebedevna/neverthrow-utils";
import { ReadonlyURL, rurl } from "@lebedevna/readonly-url";
import { LinkifyIt } from "linkify-it";
import { ok } from "neverthrow";

const linkify = new LinkifyIt({ fuzzyLink: true });

function isYoutubeUrl(url: ReadonlyURL) {
  const host = url.hostname.toLowerCase();
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

export function getYoutubeTiming(url: string) {
  return safeFetch(url).andThen((html) => {
    const duration = html.match(/"lengthSeconds":"(\d+)"/)?.[1];
    if (duration === undefined) {
      return erro({ type: "youtube: duration not found", html });
    }

    const endOfVideoSeconds = Number(duration);
    if (!Number.isSafeInteger(endOfVideoSeconds) || endOfVideoSeconds <= 0) {
      return erro({ type: "youtube: invalid duration", duration: endOfVideoSeconds });
    }

    const parsedUrl = rurl(url);
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
  message ??= "";

  const youtubeUrls = Iterator.from(linkify.match(message) ?? [])
    .map((match) => rurl(match.url))
    .map((url) => url.withProtocol("https"))
    .filter((url) => isYoutubeUrl(url))
    .map((url) => url.href);

  return Array.from(new Set(youtubeUrls));
}

export function youtubeVideoId(url: string) {
  const parsed = rurl(url);
  const host = parsed.hostname.toLowerCase();
  const id =
    host === "youtu.be"
      ? parsed.pathname.split("/")[1]
      : (parsed.searchParams.get("v") ??
        parsed.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);
  return id || null;
}
