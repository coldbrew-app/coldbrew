import { createFileRoute } from "@tanstack/react-router";
import { CosmicPageHeader } from "@web/components/cosmic-page-header";
import {
  DONATION_ALERTS_NAME,
  DonationAlertsConnectionStatus,
  DonationAlertsMark,
} from "@web/components/donation-alerts";
import { Icons } from "@web/components/icons";
import { Button } from "@web/components/ui/button";
import { preloadRouteQuery } from "@web/lib/trpc";

import { useAuthUrlQ, useDisconnectM, useUserInfo } from "../../hooks/api";
import { createTranslator, useI18n } from "../../lib/i18n";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: RouteComponent,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("integrations")} · Coldbrew` }],
  }),
  loader: async ({ context }) => {
    if (!context.viewer) return;
    await preloadRouteQuery(context.queryClient, context.trpc.authUrls.queryOptions());
  },
});

function RouteComponent() {
  const userInfo = useUserInfo();
  const connected = userInfo !== null && userInfo.hasDonationAlertsConnection;
  const authUrlQ = useAuthUrlQ(!connected);

  const disconnectM = useDisconnectM();
  const { t } = useI18n();

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4">
      <CosmicPageHeader
        description={t("integrationsDescription")}
        eyebrow={t("orbitCaption")}
        title={t("integrations")}
        variant="beans"
      />
      <div className="flex w-full flex-col gap-4">
        <article className="cosmic-panel overflow-hidden">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            <DonationAlertsMark size="lg" />
            <div className="min-w-0 grow">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-lg font-semibold text-card-foreground">
                  {/* TODO: add payment link */}
                  <a
                    href="https://donationalerts.com/dashboard"
                    className="cursor-pointer hover:underline"
                    target="_blank"
                  >
                    {DONATION_ALERTS_NAME}
                  </a>
                </h2>
                <DonationAlertsConnectionStatus connected={connected} />
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
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
            ) : authUrlQ.data ? (
              <a
                className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 sm:w-auto"
                href={authUrlQ.data.donationAlerts}
              >
                {t("connectDonationAlerts")}
                <Icons.chevronRight aria-hidden="true" size={16} />
              </a>
            ) : (
              <Button
                className="w-full sm:w-auto"
                disabled={authUrlQ.isLoading}
                onClick={() => void authUrlQ.refetch()}
                size="lg"
                type="button"
                variant={authUrlQ.isError ? "outline" : "default"}
              >
                {authUrlQ.isLoading ? (
                  <Icons.loader aria-hidden="true" className="animate-spin" />
                ) : (
                  <Icons.retry aria-hidden="true" />
                )}
                {t(authUrlQ.isLoading ? "loadingAuthorization" : "authorizationUnavailable")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border bg-muted/55 px-5 py-3 text-xs text-muted-foreground sm:px-6">
            <Icons.secure aria-hidden="true" size={15} className="shrink-0 text-primary" />
            {t(connected ? "secureConnection" : "secureAuthorization")}
          </div>
        </article>

        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <Icons.checked aria-hidden="true" size={15} className="text-primary" />
          {t("moreIntegrationsSoon")}
        </div>
      </div>
    </section>
  );
}
