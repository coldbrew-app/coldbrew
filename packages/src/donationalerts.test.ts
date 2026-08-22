import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessTokenSchema } from "./schemas.js";

const state = vi.hoisted(() => ({
  clients: [] as Array<
    EventEmitter & { authorization: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
  >,
}));

vi.mock("@kash-88/alerts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@kash-88/alerts")>();

  return {
    ...original,
    WebServer: class extends EventEmitter {
      authorization = vi.fn(async () => undefined);
      close = vi.fn();

      constructor() {
        super();
        state.clients.push(this);
      }
    },
  };
});

const { DonationAlertsFacade } = await import("./donationalerts.js");

const accessToken = AccessTokenSchema.parse("access-token");
const createFacade = () =>
  new DonationAlertsFacade({ clientId: "client-id", clientSecret: "secret", timeZone: "UTC" });

afterEach(() => {
  state.clients.length = 0;
});

describe("DonationAlertsFacade.subscribeToDonations", () => {
  it("does not open a connection for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const iterator = createFacade().subscribeToDonations(accessToken, controller.signal);

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(state.clients).toHaveLength(0);
  });

  it("ends the iterator and closes the connection when aborted", async () => {
    const controller = new AbortController();
    const iterator = createFacade().subscribeToDonations(accessToken, controller.signal);
    const nextEvent = iterator.next();
    const client = state.clients[0]!;

    controller.abort();

    await expect(nextEvent).resolves.toEqual({ done: true, value: undefined });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("closes the connection when the consumer stops iterating", async () => {
    const iterator = createFacade().subscribeToDonations(accessToken, new AbortController().signal);
    const nextEvent = iterator.next();
    const client = state.clients[0]!;

    client.emit("message", {
      type: "donation",
      result: {
        channel: "$alerts:donation_1",
        data: {
          data: {
            id: 1,
            username: "Streamer",
            message: "Thank you",
            amount: "10.00",
            currency: "USD",
            created_at: "2026-08-22 12:00:00",
          },
        },
      },
    });

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: { name: "donation", data: { sourceDonationId: "1" } },
    });
    await iterator.return();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("yields a terminal error before ending", async () => {
    const iterator = createFacade().subscribeToDonations(accessToken, new AbortController().signal);
    const nextEvent = iterator.next();
    const client = state.clients[0]!;

    client.emit("error", new Error("socket failed"));

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: { name: "error", data: { type: "donationalerts: request error" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("ends when authorization fails", async () => {
    const iterator = createFacade().subscribeToDonations(accessToken, new AbortController().signal);
    const nextEvent = iterator.next();
    const client = state.clients[0]!;
    client.authorization.mockRejectedValueOnce(new Error("authorization failed"));

    client.emit("open");

    await expect(nextEvent).resolves.toMatchObject({
      done: false,
      value: { name: "error", data: { type: "donationalerts: request error" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(client.close).toHaveBeenCalledOnce();
  });
});
