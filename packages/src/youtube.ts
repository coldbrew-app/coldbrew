import { rurl, type ReadonlyURL } from "@lebedevna/readonly-url";
import { LinkifyIt } from "linkify-it";

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
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
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
  if (parsedUrl === null || !isYoutubeUrl(parsedUrl)) {
    return null;
  }

  const host = parsedUrl.hostname.toLowerCase();
  const id =
    host === "youtu.be"
      ? parsedUrl.pathname.split("/")[1]
      : (parsedUrl.searchParams.get("v") ??
        parsedUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);
  return id || null;
}

export function parseYoutubeTimestamp(value: string | null) {
  if (value === null) {
    return null;
  }
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }

  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (match === null || match[0] === "") {
    return null;
  }

  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  const totalSeconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isSafeInteger(totalSeconds) ? totalSeconds : null;
}

export function extractYoutubeUrls(message: string | null) {
  const youtubeUrls = (linkify.match(message ?? "") ?? [])
    .map((match) => parseUrl(match.url))
    .filter((url): url is ReadonlyURL => url !== null && isYoutubeUrl(url))
    .map((url) => (url.protocol === "http:" ? `https:${url.href.slice(5)}` : url.href));

  return Array.from(new Set(youtubeUrls));
}
