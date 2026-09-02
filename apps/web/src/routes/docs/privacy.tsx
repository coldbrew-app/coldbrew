import { Link, createFileRoute } from "@tanstack/react-router";
import { createTranslator, useI18n } from "@web/lib/i18n";

export const Route = createFileRoute("/docs/privacy")({
  component: PrivacyPolicy,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("privacyPolicy")} · Coldbrew` }],
  }),
});

function PrivacyPolicy() {
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
              {t("privacyPolicy")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("legalEffectiveDate")}</p>
          </div>
        </header>

        <div className="flex flex-col gap-6 text-sm leading-6 text-muted-foreground">
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("privacyDataTitle")}
            </h2>
            <p>{t("privacyDataDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("privacyPurposeTitle")}
            </h2>
            <p>{t("privacyPurposeDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("privacySharingTitle")}
            </h2>
            <p>{t("privacySharingDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("privacyRetentionTitle")}
            </h2>
            <p>{t("privacyRetentionDescription")}</p>
          </section>
          <p>{t("privacyAgreement")}</p>
        </div>

        <footer className="border-t border-border pt-6 text-sm">
          <Link className="text-primary hover:text-primary/75" to="/docs/tos">
            {t("termsOfService")}
          </Link>
        </footer>
      </article>
    </main>
  );
}
