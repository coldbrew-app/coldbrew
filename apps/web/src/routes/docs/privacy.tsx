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
  privacyEffectiveDate: {
    en: "Effective as of September 9, 2026.",
    ru: "Действует с 9 сентября 2026 года.",
  },
  privacyDataTitle: {
    en: "Data we process",
    ru: "Какие данные мы обрабатываем",
  },
  privacyDataDescription: {
    en: "We process account data: name, email address, and profile image. When you connect YouTube chat, Coldbrew receives OAuth access and refresh tokens, your channel identity, active-broadcast information, live chat messages, and identifiers needed for moderation. Connected donation sources provide the account, donation, and token data needed to operate those integrations.",
    ru: "Мы обрабатываем данные учётной записи: имя, адрес электронной почты и изображение профиля. При подключении чата YouTube Coldbrew получает токены доступа и обновления OAuth, сведения о вашем канале и активной трансляции, сообщения чата и идентификаторы для модерации. Подключённые источники донатов передают данные аккаунта, донатов и токенов, необходимые для работы этих интеграций.",
  },
  privacyPurposeTitle: {
    en: "Why we use it",
    ru: "Зачем это нужно",
  },
  privacyPurposeDescription: {
    en: "This data lets us create and protect your account, receive donations, build the video queue, and maintain the service. YouTube data is used only to show the connected live chat, send messages you request, perform moderation actions you initiate, and display chat in an overlay you enable.",
    ru: "Эти данные нужны, чтобы создать и защитить учётную запись, получать донаты, формировать очередь видео и поддерживать работу сервиса. Данные YouTube используются только для показа подключённого чата, отправки запрошенных вами сообщений, выполнения инициированных вами действий модерации и вывода чата в включённый вами оверлей.",
  },
  privacySharingTitle: {
    en: "Sharing and access",
    ru: "Передача и доступ",
  },
  privacySharingDescription: {
    en: "We do not sell personal or Google user data, use it for advertising, or share it except as needed to operate an integration you connected. If you enable a public queue or chat overlay, the information selected for that feature is available to visitors through its public link.",
    ru: "Мы не продаём персональные данные или данные пользователей Google, не используем их для рекламы и не передаём иначе, чем для работы подключённой вами интеграции. Если вы включили публичную очередь или чат-оверлей, выбранные для этой функции сведения доступны посетителям по публичной ссылке.",
  },
  privacyProtectionTitle: {
    en: "How we protect your data",
    ru: "Как мы защищаем данные",
  },
  privacyProtectionDescription: {
    en: "We protect sensitive data in transit with HTTPS/TLS. Google OAuth access and refresh tokens are encrypted at rest using authenticated AES-256-GCM encryption, and the encryption secret is kept separately from the database. Access to non-public account and Google user data is restricted to the authenticated account owner and to service components that need it to provide the requested features; internal service requests are authenticated with separate credentials. We do not expose OAuth tokens to public pages or client-side application code. Administrative access is limited to authorized personnel who need it to operate or secure Coldbrew.",
    ru: "Мы защищаем чувствительные данные при передаче с помощью HTTPS/TLS. Токены доступа и обновления Google OAuth хранятся в зашифрованном виде с использованием аутентифицированного шифрования AES-256-GCM, а секрет шифрования хранится отдельно от базы данных. Доступ к непубличным данным аккаунта и данным пользователей Google ограничен владельцем аккаунта, прошедшим аутентификацию, и компонентами сервиса, которым эти данные нужны для запрошенных функций; запросы между компонентами сервиса аутентифицируются отдельными учётными данными. Мы не передаём OAuth-токены на публичные страницы или в клиентский код приложения. Административный доступ предоставляется только уполномоченным лицам, которым он необходим для работы или защиты Coldbrew.",
  },
  privacyRetentionTitle: {
    en: "Retention and your rights",
    ru: "Хранение и ваши права",
  },
  privacyRetentionDescription: {
    en: "YouTube OAuth tokens are encrypted at rest and retained only while the connection is active. Live chat message text is processed transiently and is not stored in the Coldbrew database. Disconnecting YouTube removes its stored tokens and connection data from Coldbrew; you can also revoke access in your Google Account. When you delete your Coldbrew account, its related data is deleted subject to applicable law.",
    ru: "Токены OAuth YouTube хранятся в зашифрованном виде только пока подключение активно. Текст сообщений чата обрабатывается временно и не сохраняется в базе данных Coldbrew. Отключение YouTube удаляет его токены и данные подключения из Coldbrew; доступ также можно отозвать в аккаунте Google. При удалении аккаунта Coldbrew связанные с ним данные удаляются с учётом требований закона.",
  },
  privacyAgreement: {
    en: "By using Coldbrew, you agree to this policy. For questions about data processing, contact the service owner through an available support channel.",
    ru: "Используя Coldbrew, вы соглашаетесь с этой политикой. По вопросам обработки данных свяжитесь с владельцем сервиса через доступный канал поддержки.",
  },
});

export const Route = createFileRoute("/docs/privacy")({
  component: PrivacyPolicy,
  head: ({ match }) => ({
    meta: [
      { title: `${createTranslator(match.context.locale, i18n)("privacyPolicy")} · Coldbrew` },
    ],
  }),
});

function PrivacyPolicy() {
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
              {t("privacyPolicy")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("privacyEffectiveDate")}</p>
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
              {t("privacyProtectionTitle")}
            </h2>
            <p>{t("privacyProtectionDescription")}</p>
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
