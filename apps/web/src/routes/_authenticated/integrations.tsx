import { createFileRoute } from "@tanstack/react-router";
import { Icons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";

import { useAuthUrl, useDisconnectM, useUserInfo } from "../../hooks/api";
import { createTranslator, useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: RouteComponent,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("integrations")} · Coldbrew` }],
  }),
});

function RouteComponent() {
  const authUrl = useAuthUrl();
  const userInfo = useUserInfo();
  const connected = userInfo !== null && userInfo.hasDonationalertsAccessToken;

  const disconnectM = useDisconnectM();
  const { t } = useI18n();

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="w-full">
        <h1 className="text-[clamp(27px,3vw,33px)] font-bold tracking-tight text-[#27243a]">
          {t("integrations")}
        </h1>
        <p className="mt-2.5 max-w-xl text-sm text-[#888597]">{t("integrationsDescription")}</p>

        <article className="mt-8 overflow-hidden rounded-xl border border-[#eae8ef] bg-white sm:mt-10">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-linear-to-br from-orange-400 to-rose-500 text-sm font-bold text-white shadow-sm">
              DA
            </div>
            <div className="min-w-0 grow">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-[#403c52]">
                  {/* TODO: add payment link */}
                  <a
                    href="https://donationalerts.com/dashboard"
                    className="cursor-pointer hover:underline"
                    target="_blank"
                  >
                    DonationAlerts
                  </a>
                </h2>
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-600"}`}
                >
                  <i className="size-1.5 rounded-full bg-current" />
                  {t(connected ? "connected" : "notConnected")}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[#888597]">
                {connected ? t("donationsSyncing") : t("importDonations")}
              </p>
            </div>
            {connected ? (
              <Button
                variant="destructive"
                size="lg"
                disabled={disconnectM.isPending}
                onClick={() => disconnectM.mutate({ source: "donationalerts" })}
              >
                {t(disconnectM.isPending ? "disconnecting" : "disconnect")}
              </Button>
            ) : (
              <a
                className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 sm:w-auto"
                href={authUrl.donationAlerts}
              >
                {t("connectDonationAlerts")}
                <Icons.chevronRight aria-hidden="true" size={16} />
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-[#f0eff3] bg-[#fcfcfd] px-5 py-3 text-xs text-[#888597] sm:px-6">
            <Icons.secure aria-hidden="true" size={15} className="shrink-0 text-violet-600" />
            {t("secureAuthorization")}
          </div>
        </article>

        <div className="mt-5 flex items-center gap-2 text-xs text-[#9895a6]">
          <Icons.checked aria-hidden="true" size={15} className="text-emerald-600" />
          {t("moreIntegrationsSoon")}
        </div>
      </div>
    </section>
  );
}
