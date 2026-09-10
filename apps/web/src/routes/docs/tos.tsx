import { Link, createFileRoute } from "@tanstack/react-router";
import { CosmicArt } from "@web/components/cosmic-art";
import { createI18n, createTranslator, useI18n } from "@web/lib/i18n";

import productMark from "../../../assets/logo.png";

const i18n = createI18n({
  privacyPolicy: {
    en: "Privacy policy",
    ru: "Политика конфиденциальности",
  },
  termsOfService: {
    en: "Terms of service",
    ru: "Условия использования",
  },
  legalEffectiveDate: {
    en: "Effective as of September 2, 2026.",
    ru: "Действует с 2 сентября 2026 года.",
  },
  termsServiceTitle: {
    en: "The service",
    ru: "Сервис",
  },
  termsServiceDescription: {
    en: "Coldbrew helps streamers collect donation data from connected sources, build a video queue, and show it on stream. The service is provided as is and may be changed or extended.",
    ru: "Coldbrew помогает стримерам собирать данные о донатах из подключённых источников, формировать очередь видео и выводить их на стрим. Сервис предоставляется «как есть» и может изменяться или дополняться.",
  },
  termsAccountTitle: {
    en: "Account and integrations",
    ru: "Учётная запись и интеграции",
  },
  termsAccountDescription: {
    en: "You are responsible for keeping your account secure, for the legality of connected accounts, and for having the right to use them. By connecting a third-party platform, you also accept its terms. You can disconnect an integration in settings.",
    ru: "Вы отвечаете за безопасность своей учётной записи, законность подключаемых аккаунтов и наличие прав на их использование. Подключая стороннюю платформу, вы также принимаете её правила и условия. Вы можете отключить интеграцию в настройках.",
  },
  termsAcceptableUseTitle: {
    en: "Acceptable use",
    ru: "Допустимое использование",
  },
  termsAcceptableUseDescription: {
    en: "You may not use Coldbrew to break the law, infringe third-party rights or connected-platform rules, or attempt to disrupt the service or its security. You are responsible for the content of donations, messages, videos, and public pages created through the service.",
    ru: "Нельзя использовать Coldbrew для нарушения закона, прав третьих лиц, правил подключённых платформ, а также для попыток нарушить работу или безопасность сервиса. Вы несёте ответственность за контент донатов, сообщений, видео и публичных страниц, созданных с помощью сервиса.",
  },
  termsLiabilityTitle: {
    en: "Limitation of liability",
    ru: "Ограничение ответственности",
  },
  termsLiabilityDescription: {
    en: "We aim to keep the service available and accurate, but do not guarantee uninterrupted operation, the preservation of third-party-platform data, or the absence of errors. To the extent permitted by law, Coldbrew is not liable for indirect losses arising from use of the service.",
    ru: "Мы стремимся поддерживать доступность и корректность сервиса, но не гарантируем его бесперебойную работу, сохранность данных сторонних платформ или отсутствие ошибок. Насколько это допускает закон, Coldbrew не отвечает за косвенные убытки, возникшие при использовании сервиса.",
  },
  termsAgreement: {
    en: "By continuing to use Coldbrew, you accept these terms and the Privacy policy.",
    ru: "Продолжая пользоваться Coldbrew, вы принимаете эти условия и Политику конфиденциальности.",
  },
});

export const Route = createFileRoute("/docs/tos")({
  component: TermsOfService,
  head: ({ match }) => ({
    meta: [
      { title: `${createTranslator(match.context.locale, i18n)("termsOfService")} · Coldbrew` },
    ],
  }),
});

function TermsOfService() {
  const { t } = useI18n(i18n);

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
              {t("termsOfService")}
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
              {t("termsServiceTitle")}
            </h2>
            <p>{t("termsServiceDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-medium text-foreground sm:text-2xl">
              {t("termsAccountTitle")}
            </h2>
            <p>{t("termsAccountDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-medium text-foreground sm:text-2xl">
              {t("termsAcceptableUseTitle")}
            </h2>
            <p>{t("termsAcceptableUseDescription")}</p>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-medium text-foreground sm:text-2xl">
              {t("termsLiabilityTitle")}
            </h2>
            <p>{t("termsLiabilityDescription")}</p>
          </section>
          <p>{t("termsAgreement")}</p>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-border pt-6 pb-8 text-sm">
          <Link
            className="rounded-sm text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            to="/docs/privacy"
          >
            {t("privacyPolicy")}
          </Link>
        </footer>
      </article>
    </main>
  );
}
