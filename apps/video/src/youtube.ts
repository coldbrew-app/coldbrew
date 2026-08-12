import { ReadonlyURL, readonlyUrl } from "@lebedevna/readonly-url";
import { fetchText } from "@omnistream/packages/neverthrow/fetch.js";
import { createTaggedError } from "errore";
import { LinkifyIt } from "linkify-it";
import { err, ok } from "neverthrow";

const linkify = new LinkifyIt({ fuzzyLink: true });

export function extractYoutubeUrls(message: string | null) {
  message ??= "";

  const youtubeUrls = Iterator.from(linkify.match(message) ?? [])
    .map((match) => readonlyUrl(match.url))
    .map((url) => url.withProtocol("https"))
    .filter((url) => isYoutubeUrl(url))
    .map((url) => url.href);

  return Array.from(new Set(youtubeUrls));
}

export class DataNotFoundError extends createTaggedError({
  name: "DataNotFoundError",
  message: "not found $data\nsource:\n$source",
}) {}

export function getYoutubeDurationSeconds(url: string) {
  return fetchText(url).andThen((html) => {
    const duration = html.match(/"lengthSeconds":"(\d+)"/)?.[1];
    if (duration === undefined) {
      return err(new DataNotFoundError({ data: "duration", source: html }));
    }
    return ok(+duration);
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
