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

import { STREAMLABS_DONATIONS_URL, StreamlabsSourceBadge } from "./streamlabs";

describe("Streamlabs source badge", () => {
  it("links to the source dashboard with an accessible label", () => {
    const html = renderToStaticMarkup(<StreamlabsSourceBadge />);

    expect(html).toContain(`href="${STREAMLABS_DONATIONS_URL}"`);
    expect(html).toContain('aria-label="Открыть Streamlabs"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
