import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument, LegalSection } from "@web/components/legal-document";
import { createI18n, createTranslator, useI18n } from "@web/lib/i18n";

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
    en: "Effective as of September 15, 2026.",
    ru: "Действует с 15 сентября 2026 года.",
  },
  termsServiceTitle: {
    en: "The service",
    ru: "Сервис",
  },
  termsServiceDescription: {
    en: "StreamBrew helps streamers collect donation data from connected sources, build a video queue, and show it on stream. The service is provided as is and may be changed or extended.",
    ru: "StreamBrew помогает стримерам собирать данные о донатах из подключённых источников, формировать очередь видео и выводить их на стрим. Сервис предоставляется «как есть» и может изменяться или дополняться.",
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
    en: "You may not use StreamBrew to break the law, infringe third-party rights or connected-platform rules, or attempt to disrupt the service or its security. You are responsible for the content of donations, messages, videos, and public pages created through the service.",
    ru: "Нельзя использовать StreamBrew для нарушения закона, прав третьих лиц, правил подключённых платформ, а также для попыток нарушить работу или безопасность сервиса. Вы несёте ответственность за контент донатов, сообщений, видео и публичных страниц, созданных с помощью сервиса.",
  },
  termsLiabilityTitle: {
    en: "Limitation of liability",
    ru: "Ограничение ответственности",
  },
  termsLiabilityDescription: {
    en: "We aim to keep the service available and accurate, but do not guarantee uninterrupted operation, the preservation of third-party-platform data, or the absence of errors. To the extent permitted by law, StreamBrew is not liable for indirect losses arising from use of the service.",
    ru: "Мы стремимся поддерживать доступность и корректность сервиса, но не гарантируем его бесперебойную работу, сохранность данных сторонних платформ или отсутствие ошибок. Насколько это допускает закон, StreamBrew не отвечает за косвенные убытки, возникшие при использовании сервиса.",
  },
  termsAgreement: {
    en: "By continuing to use StreamBrew, you accept these terms and the Privacy policy.",
    ru: "Продолжая пользоваться StreamBrew, вы принимаете эти условия и Политику конфиденциальности.",
  },
});

export const Route = createFileRoute("/docs/tos")({
  component: TermsOfService,
  head: ({ match }) => ({
    meta: [
      { title: `${createTranslator(match.context.locale, i18n)("termsOfService")} · StreamBrew` },
    ],
  }),
});

function TermsOfService() {
  const { t } = useI18n(i18n);

  return (
    <LegalDocument
      effectiveDate={t("legalEffectiveDate")}
      otherDocument={{ label: t("privacyPolicy"), to: "/docs/privacy" }}
      title={t("termsOfService")}
    >
      <LegalSection title={t("termsServiceTitle")}>{t("termsServiceDescription")}</LegalSection>
      <LegalSection title={t("termsAccountTitle")}>{t("termsAccountDescription")}</LegalSection>
      <LegalSection title={t("termsAcceptableUseTitle")}>
        {t("termsAcceptableUseDescription")}
      </LegalSection>
      <LegalSection title={t("termsLiabilityTitle")}>{t("termsLiabilityDescription")}</LegalSection>
      <p>{t("termsAgreement")}</p>
    </LegalDocument>
  );
}
