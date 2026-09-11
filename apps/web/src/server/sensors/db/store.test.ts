import {
  AuthUserIdSchema,
  DonationIdSchema,
  UserIdSchema,
  SlugSchema,
} from "@coldbrew/packages/schemas.js";
import { describe, expect, it, vi } from "vitest";

import { Store } from "./store.js";

describe("Store.getOrCreateUserId", () => {
  it("propagates an unexpected database error without retrying", async () => {
    const databaseError = new Error("database unavailable");
    const query = vi.fn(async () => []);
    const begin = vi.fn(async () => await Promise.reject(databaseError));
    const store = new Store(Object.assign(query, { begin }) as never);

    await expect(
      store.getOrCreateUserId(AuthUserIdSchema.parse("auth-user-id"), SlugSchema.parse("streamer")),
    ).rejects.toBe(databaseError);
    expect(begin).toHaveBeenCalledOnce();
  });
});

describe("Store.listDonationsPage", () => {
  const occurredAt = new Date("2026-01-01T00:00:00Z");
  const donation = {
    donationId: "9007199254740993",
    userId: 7,
    source: "donationalerts",
    sourceDonationId: "source-1",
    author: "Supporter",
    message: "Two video links",
    amount: "50.00",
    currency: "USD",
    sourceCreatedAt: occurredAt.toISOString(),
    occurredAt,
    videosParsedAt: occurredAt,
  };
  const video = {
    donationId: donation.donationId,
    videoId: "9007199254740995",
    url: "https://youtu.be/abcdefghijk",
    title: "A video title",
    startSeconds: 13,
    endSeconds: 73,
    queueAmount: "4000.00",
    queueCurrency: "RUB",
    priorityLabel: "Priority",
    watchedAt: occurredAt,
    bookmarkedAt: null,
  };

  it("returns every stored video with exact IDs, timing and queue money separately from original money", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([donation, { ...donation, donationId: "2", videosParsedAt: null }])
      .mockResolvedValueOnce([
        video,
        { ...video, videoId: "9007199254740996", queueAmount: null, priorityLabel: null },
      ]);
    const store = new Store(query as never);
    const page = await store.listDonationsPage(UserIdSchema.parse(7), {
      page: 1,
      pageSize: 25,
      query: "",
      occurredAfter: null,
    });
    expect(page.items[0]).toMatchObject({
      donationId: 9007199254740993n,
      amount: "50.00",
      currency: "USD",
      videosParsedAt: occurredAt,
      videos: [
        {
          videoId: 9007199254740995n,
          title: "A video title",
          startSeconds: 13,
          endSeconds: 73,
          queueAmount: "4000.00",
          queueCurrency: "RUB",
          watchedAt: occurredAt,
        },
        { videoId: 9007199254740996n, queueAmount: null, priorityLabel: null },
      ],
    });
    expect(page.items[1]).toMatchObject({ videos: [], videosParsedAt: null });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("scopes focused donations to their owner and does not load videos for an unavailable donation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);
    const store = new Store(query as never);
    const page = await store.listDonationsPage(UserIdSchema.parse(7), {
      page: 1,
      pageSize: 25,
      query: "",
      occurredAfter: null,
      donationId: DonationIdSchema.parse("9007199254740993"),
    });
    expect(page.items).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [strings, ...values] of query.mock.calls) {
      expect(strings.join("?")).toContain("WHERE user_id = ?");
      expect(strings.join("?")).toContain("donation_id = ?");
      expect(values).toContain(7);
      expect(values).toContain("9007199254740993");
    }
  });

  it("filters both the count and records by donation source", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);
    const store = new Store(query as never);

    await store.listDonationsPage(UserIdSchema.parse(7), {
      page: 1,
      pageSize: 25,
      query: "",
      occurredAfter: null,
      source: "streamlabs",
    });

    expect(query).toHaveBeenCalledTimes(2);
    for (const [strings, ...values] of query.mock.calls) {
      expect(strings.join("?")).toContain("source = ?::donation_source");
      expect(values.filter((value) => value === "streamlabs")).toHaveLength(2);
    }
  });
});
