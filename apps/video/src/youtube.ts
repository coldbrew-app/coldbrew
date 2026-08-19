import { erro } from "@coldbrew/packages/erro.js";
import { fetchText } from "@coldbrew/packages/neverthrow/fetch.js";
import { ReadonlyURL, rurl } from "@lebedevna/readonly-url";
import { LinkifyIt } from "linkify-it";
import { ok } from "neverthrow";

const linkify = new LinkifyIt({ fuzzyLink: true });

export function extractYoutubeUrls(message: string | null) {
  message ??= "";

  const youtubeUrls = Iterator.from(linkify.match(message) ?? [])
    .map((match) => rurl(match.url))
    .map((url) => url.withProtocol("https"))
    .filter((url) => isYoutubeUrl(url))
    .map((url) => url.href);

  return Array.from(new Set(youtubeUrls));
}

export function getYoutubeDurationMinutes(url: string) {
  return fetchText(url).andThen((html) => {
    const duration = html.match(/"lengthSeconds":"(\d+)"/)?.[1];
    if (duration === undefined) {
      return erro({ type: "youtube: duration not found", html });
    }
    const { max, ceil } = Math;
    return ok(max(1, ceil((+duration - 15) / 60)));
  });
}

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
