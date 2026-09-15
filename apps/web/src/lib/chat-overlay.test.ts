import { describe, expect, it } from "vitest";

import { ChatOverlaySearchSchema, withChatOverlayBackground } from "./chat-overlay";

describe("chat overlay background", () => {
  it("defaults missing and invalid backgrounds to transparent", () => {
    expect(ChatOverlaySearchSchema.parse({})).toEqual({ background: "transparent" });
    expect(ChatOverlaySearchSchema.parse({ background: "blue" })).toEqual({
      background: "transparent",
    });
  });

  it.each(["transparent", "black", "white"] as const)(
    "adds the %s background to an overlay URL without changing its token",
    (background) => {
      expect(
        withChatOverlayBackground(
          "https://streambrew.example/chat/overlay/secret-token",
          background,
        ),
      ).toBe(`https://streambrew.example/chat/overlay/secret-token?background=${background}`);
    },
  );
});
