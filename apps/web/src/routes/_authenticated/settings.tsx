import { createFileRoute } from "@tanstack/react-router";
import { QueueCurrencyEditor } from "@web/components/queue-currency-editor";

import { createTranslator } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("settings")} · Coldbrew` }],
  }),
});

function Settings() {
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <QueueCurrencyEditor />
    </main>
  );
}
