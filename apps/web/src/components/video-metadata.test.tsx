import { SharedVideoSchema, VideoSchema } from "@coldbrew/packages/schemas.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/i18n")>();
  return { ...actual, useI18n: () => ({ locale: "ru", t: actual.createTranslator("ru") }) };
});

import { SharedVideoCard } from "./shared-video-card";
import VideoCard from "./video-card";

const base = {
  videoId: "1",
  videoPriorityId: null,
  provider: "youtube",
  url: "https://www.youtube.com/watch?v=_JXL6Fn99l8&t=13s",
  startSeconds: 0,
  endSeconds: null,
  durationSeconds: null,
  watchedAt: null,
  priorityLabel: null,
  createdAt: "2026-09-08T09:00:00Z",
  metadataUnavailable: false,
};

describe("videos awaiting metadata", () => {
  it("renders the owner card and playback without inventing an end", () => {
    const video = VideoSchema.parse({
      ...base,
      providerVideoId: "_JXL6Fn99l8",
      source: "manual",
      donation: null,
      bookmarkedAt: null,
      queueAmount: "10.00",
      queueCurrency: "RUB",
      metadataRetryAt: null,
    });
    const html = renderToStaticMarkup(<VideoCard video={video} onRetryMetadata={() => {}} />);
    expect(html).toContain("Длительность уточняется");
    expect(html).toContain("Без очереди");
    expect(html).toContain("Повторить получение данных");
    expect(html).toContain("/embed/_JXL6Fn99l8?start=0");
    expect(html).not.toContain("end=null");
    expect(html).not.toContain("NaN");
  });

  it("renders unavailable public videos without retry controls", () => {
    const video = SharedVideoSchema.parse({
      ...base,
      metadataUnavailable: true,
      displayAmount: null,
      displayCurrency: null,
    });
    const html = renderToStaticMarkup(<SharedVideoCard video={video} />);
    expect(html).toContain("Не удалось получить длительность");
    expect(html).not.toContain("Повторить получение данных");
    expect(html).not.toContain("end=null");
  });
});
