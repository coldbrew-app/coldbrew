import { LinkifyIt } from "linkify-it";
import { useMemo } from "react";

const linkify = new LinkifyIt({ fuzzyLink: true });

export function useTextWithLinks(text: string) {
  return useMemo(() => {
    const data: (
      | { type: "string"; value: string }
      | { type: "url"; text: string; href: string }
    )[] = [];
    let lastIndex = 0;

    for (const link of linkify.match(text) ?? []) {
      data.push({ type: "string", value: text.slice(lastIndex, link.index) });
      data.push({ type: "url", text: link.raw, href: link.url });
      lastIndex = link.lastIndex;
    }
    data.push({ type: "string", value: text.slice(lastIndex) });

    return data;
  }, [text]);
}
