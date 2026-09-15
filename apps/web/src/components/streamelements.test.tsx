import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { I18nMessages } from "../lib/i18n";

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

import { StreamElementsSourceBadge } from "./streamelements";

describe("StreamElements source badge", () => {
  it("links to the source dashboard with an accessible label", () => {
    const html = renderToStaticMarkup(<StreamElementsSourceBadge />);

    expect(html).toContain('href="https://streamelements.com/dashboard/revenue/tips"');
    expect(html).toContain('aria-label="Открыть StreamElements"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
