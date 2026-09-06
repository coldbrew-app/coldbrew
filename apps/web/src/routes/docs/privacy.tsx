import { Link, createFileRoute } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { createTranslator, useI18n } from "@web/lib/i18n";

import productMark from "../../../assets/logo.png";

export const Route = createFileRoute("/docs/privacy")({
  component: PrivacyPolicy,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("privacyPolicy")} · Coldbrew` }],
  }),
});

function PrivacyPolicy() {
  const { t } = useI18n();

  return (
    <main className="relative min-h-dvh bg-background px-5 py-6 text-foreground sm:px-8 sm:py-10">
      <article className="relative mx-auto flex w-full max-w-3xl flex-col gap-10 sm:gap-12">
        <header className="relative flex flex-col gap-8 overflow-hidden border-b border-border pb-8 sm:gap-12 sm:pb-10">
          <Link
            className="relative z-10 flex w-fit items-center gap-2 font-heading text-xl font-medium text-foreground sm:text-2xl hover:text-primary focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            to="/"
          >
            <img alt="" className="size-9 object-contain" src={productMark} />
            Coldbrew
          </Link>
          <div className="relative z-10 flex min-w-0 flex-col gap-4">
            <h1 className="max-w-2xl font-heading text-[clamp(1.625rem,4vw,2.75rem)] leading-tight font-medium tracking-tight [overflow-wrap:anywhere]">
              {t("privacyPolicy")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("legalEffectiveDate")}</p>
          </div>
          <CosmicArt
            variant="orbit"
            className="pointer-events-none absolute -right-10 -top-10 w-48 text-primary/35 opacity-35"
          />
        </header>

        <div className="flex flex-col gap-9 text-base leading-7 text-muted-foreground">
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-medium text-foreground sm:text-2xl">
              {t("privacyDataTitle")}
            </h2>
            <p>{t("privacyDataDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-medium text-foreground sm:text-2xl">
              {t("privacyPurposeTitle")}
            </h2>
            <p>{t("privacyPurposeDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-medium text-foreground sm:text-2xl">
              {t("privacySharingTitle")}
            </h2>
            <p>{t("privacySharingDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-medium text-foreground sm:text-2xl">
              {t("privacyRetentionTitle")}
            </h2>
            <p>{t("privacyRetentionDescription")}</p>
          </section>
          <p>{t("privacyAgreement")}</p>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-border pt-6 pb-8 text-sm">
          <Link
            className="rounded-sm text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            to="/docs/tos"
          >
            {t("termsOfService")}
          </Link>
        </footer>
      </article>
    </main>
  );
}
