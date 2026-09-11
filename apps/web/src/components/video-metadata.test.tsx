import { SharedVideoSchema, VideoSchema } from "@coldbrew/packages/schemas.js";
import type { I18nMessages } from "@web/lib/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/i18n")>();
  return {
    ...actual,
    useI18n: (messages: I18nMessages) => ({
      locale: "ru",
      t: actual.createTranslator("ru", messages),
    }),
  };
});

import { SharedVideoCard } from "./shared-video-card";
import VideoCard from "./video-card";

const base = {
  title: "Кто останется нужным в мире ИИ?",
  videoId: "1",
  videoQueueId: 1,
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
  it("renders the owner card preview as an external link without inventing an end", () => {
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
    expect(html).toContain("Без приоритета");
    expect(html).toContain("Повторить получение данных");
    expect(html).toContain('aria-label="Повторить получение данных"');
    expect(html).toContain('aria-label="Открыть видео YouTube в новой вкладке"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("i.ytimg.com/vi/_JXL6Fn99l8/hqdefault.jpg");
    expect(html).toContain("Кто останется нужным в мире ИИ?");
    expect(html).not.toContain("youtube-nocookie.com/embed");
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
    expect(html).toContain('aria-label="Открыть видео YouTube в новой вкладке"');
    expect(html).toContain("i.ytimg.com/vi/_JXL6Fn99l8/hqdefault.jpg");
    expect(html).not.toContain("youtube-nocookie.com/embed");
    expect(html).not.toContain("Повторить получение данных");
    expect(html).not.toContain("end=null");
  });
});
