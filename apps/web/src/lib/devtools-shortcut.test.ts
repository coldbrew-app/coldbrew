import { describe, expect, it } from "vitest";

import { getDevtoolsShortcut } from "./devtools-shortcut";

const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const chromium = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("getDevtoolsShortcut", () => {
  it.each([
    [`${mac} ${chromium}`, "chromium", "⌘ Command + ⌥ Option + I"],
    [`${windows} ${chromium}`, "chromium", "Ctrl + Shift + I"],
    [`${windows} ${chromium} Edg/140.0.0.0`, "chromium", "Ctrl + Shift + I"],
    [`Mozilla/5.0 (X11; Linux x86_64) ${chromium}`, "chromium", "Ctrl + Shift + I"],
    [`${mac} Gecko/20100101 Firefox/140.0`, "firefox", "Shift + F9"],
    [`${windows} Gecko/20100101 Firefox/140.0`, "firefox", "Shift + F9"],
    [
      `${mac} AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15`,
      "safari",
      "⌘ Command + ⌥ Option + I",
    ],
    [`Mozilla/5.0 (Linux; Android 14) ${chromium}`, "mobile", null],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1",
      "mobile",
      null,
    ],
    ["", "unknown", null],
    ["unrecognized browser", "unknown", null],
  ])("selects instructions for %s", (userAgent, browser, shortcut) => {
    expect(getDevtoolsShortcut(userAgent)).toEqual({ browser, shortcut });
  });

  it("recognizes iPadOS with a desktop Safari user agent", () => {
    expect(
      getDevtoolsShortcut(`${mac} AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15`, 5),
    ).toEqual({ browser: "mobile", shortcut: null });
  });
});
