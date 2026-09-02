import { Link, createFileRoute } from "@tanstack/react-router";
import { createTranslator, useI18n } from "@web/lib/i18n";

export const Route = createFileRoute("/docs/tos")({
  component: TermsOfService,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("termsOfService")} · Coldbrew` }],
  }),
});

function TermsOfService() {
  const { t } = useI18n();

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-8 sm:py-12">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-8 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-10">
        <header className="flex flex-col gap-3">
          <Link
            className="w-fit font-heading text-xl font-semibold text-primary hover:text-primary/75"
            to="/"
          >
            Coldbrew
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("termsOfService")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("legalEffectiveDate")}</p>
          </div>
        </header>

        <div className="flex flex-col gap-6 text-sm leading-6 text-muted-foreground">
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("termsServiceTitle")}
            </h2>
            <p>{t("termsServiceDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("termsAccountTitle")}
            </h2>
            <p>{t("termsAccountDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("termsAcceptableUseTitle")}
            </h2>
            <p>{t("termsAcceptableUseDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("termsLiabilityTitle")}
            </h2>
            <p>{t("termsLiabilityDescription")}</p>
          </section>
          <p>{t("termsAgreement")}</p>
        </div>

        <footer className="border-t border-border pt-6 text-sm">
          <Link className="text-primary hover:text-primary/75" to="/docs/privacy">
            {t("privacyPolicy")}
          </Link>
        </footer>
      </article>
    </main>
  );
}
