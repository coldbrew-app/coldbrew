import { rurl } from "@lebedevna/readonly-url";
import { Link } from "@tanstack/react-router";
import { signIn } from "@web/lib/auth-client";
import { useState } from "react";

import productMark from "../../assets/logo.png";
import { createI18n, useI18n } from "../lib/i18n";
import { CosmicArt } from "./cosmic-art";
import { Icons } from "./icons";
import { Button } from "./ui/button";

const i18n = createI18n({
  signIn: {
    en: "Sign in",
    ru: "Войти",
  },
  landingHeadline: {
    en: "Donations, videos, and chat",
    ru: "Донаты, видео и чат",
  },
  landingDescription: {
    en: "Connect your streaming platforms and donation sources to StreamBrew.",
    ru: "Подключите к StreamBrew стриминговые платформы и источники донатов.",
  },
  landingFeaturesTitle: {
    en: "Tools for your stream",
    ru: "Инструменты для стрима",
  },
  landingDonationsTitle: {
    en: "Donations in one feed",
    ru: "Донаты в одной ленте",
  },
  landingDonationsDescription: {
    en: "Amounts and messages from connected donation sources.",
    ru: "Суммы и сообщения из подключённых источников донатов.",
  },
  landingVideoQueueTitle: {
    en: "Video queues",
    ru: "Очереди видео",
  },
  landingVideoQueueDescription: {
    en: "Videos from donation links or added manually, with priorities you set.",
    ru: "Видео по ссылкам из донатов и добавленные вручную. Приоритеты настраиваете вы.",
  },
  landingMultichatTitle: {
    en: "Multichat",
    ru: "Мультичат",
  },
  landingMultichatDescription: {
    en: "Read messages from connected channels in one feed.",
    ru: "Сообщения подключённых каналов в одной ленте.",
  },
  landingSharingTitle: {
    en: "Public queue and overlays",
    ru: "Публичная очередь и оверлеи",
  },
  landingSharingDescription: {
    en: "Share your video queue and show chat and donation alerts in OBS.",
    ru: "Очередь видео по ссылке, чат и алерты донатов в OBS.",
  },
  googleDataTitle: {
    en: "Google account access",
    ru: "Доступ к аккаунту Google",
  },
  googleDataDescription: {
    en: "When you continue with Google, Google shares your name, email address, and profile image with StreamBrew. We use them to create your account, identify you when you return, and show your account details.",
    ru: "При входе Google передаёт StreamBrew ваше имя, адрес электронной почты и изображение профиля. Они нужны, чтобы создать аккаунт, узнавать вас при повторном входе и показывать данные аккаунта.",
  },
  googleDataNoExtraAccess: {
    en: "Google sign-in does not give StreamBrew access to Gmail, Google Drive, or Google Calendar. If you separately connect YouTube chat, StreamBrew requests YouTube permissions for chat messages and moderation.",
    ru: "Вход через Google не даёт StreamBrew доступ к Gmail, Google Диску или Google Календарю. Если вы отдельно подключите чат YouTube, StreamBrew запросит разрешения YouTube для работы с сообщениями и модерацией.",
  },
  readPrivacyPolicy: {
    en: "Read the Privacy policy",
    ru: "Открыть Политику конфиденциальности",
  },
  landingFooter: {
    en: "StreamBrew — tools for streamers.",
    ru: "StreamBrew — инструменты для стримеров.",
  },
  legalLinks: {
    en: "Legal information",
    ru: "Юридическая информация",
  },
  redirecting: {
    en: "Redirecting…",
    ru: "Входим…",
  },
  continueWithGoogle: {
    en: "Continue with Google",
    ru: "Войти через Google",
  },
  privacyPolicy: {
    en: "Privacy policy",
    ru: "Политика конфиденциальности",
  },
  termsOfService: {
    en: "Terms of service",
    ru: "Условия использования",
  },
});

export default function SignIn() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { t } = useI18n(i18n);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    const callbackURL = rurl("/integrations", window.location.origin).href;
    await signIn.social({ provider: "google", callbackURL });
  };

  const features = [
    {
      description: t("landingDonationsDescription"),
      icon: Icons.donations,
      title: t("landingDonationsTitle"),
    },
    {
      description: t("landingVideoQueueDescription"),
      icon: Icons.video,
      title: t("landingVideoQueueTitle"),
    },
    {
      description: t("landingMultichatDescription"),
      icon: Icons.chat,
      title: t("landingMultichatTitle"),
    },
    {
      description: t("landingSharingDescription"),
      icon: Icons.externalLink,
      title: t("landingSharingTitle"),
    },
  ] as const;

  return (
    <main className="landing-world relative flex min-h-dvh flex-col items-center overflow-hidden px-5 text-foreground sm:px-8">
      <div className="cosmic-starlight pointer-events-none absolute inset-0" />

      <header className="relative z-10 flex w-full max-w-6xl items-center justify-between gap-4 border-b border-border/60 py-5 sm:py-7">
        <div className="flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight sm:text-2xl">
          <img alt="" className="size-10 object-contain sm:size-12" src={productMark} />
          StreamBrew
        </div>
        <Button
          aria-busy={isSigningIn}
          disabled={isSigningIn}
          onClick={() => void handleSignIn()}
          size="lg"
          variant="outline"
        >
          {t(isSigningIn ? "redirecting" : "signIn")}
        </Button>
      </header>

      <div className="relative z-10 flex w-full max-w-6xl flex-col gap-20 pb-8 sm:gap-28 sm:pb-12">
        <section className="landing-intro grid items-center gap-6 pt-10 lg:min-h-[680px] lg:grid-cols-[1fr_1fr] lg:gap-0 lg:pt-0">
          <div className="relative z-10 flex flex-col justify-center gap-7 py-5 lg:py-16 lg:pr-7">
            <div className="flex max-w-2xl flex-col gap-4">
              <h1 className="font-heading text-[clamp(2.75rem,5.4vw,4.75rem)] leading-[1.06] font-medium tracking-[-0.035em] text-balance">
                {t("landingHeadline")}
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                {t("landingDescription")}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3">
              <Button
                aria-busy={isSigningIn}
                className="h-12 rounded-xl px-6 text-sm shadow-lg shadow-primary/15"
                disabled={isSigningIn}
                onClick={() => void handleSignIn()}
                size="lg"
              >
                {t(isSigningIn ? "redirecting" : "continueWithGoogle")}
              </Button>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="coffee-observatory relative min-h-[560px] overflow-hidden sm:min-h-[620px]"
          >
            <CosmicArt className="pointer-events-none absolute -right-12 bottom-10 w-[360px] sm:-right-14 sm:bottom-9 sm:w-[450px]" />
          </div>
        </section>

        <section aria-labelledby="landing-features" className="flex flex-col gap-7">
          <div className="flex max-w-2xl flex-col gap-3">
            <h2
              className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl"
              id="landing-features"
            >
              {t("landingFeaturesTitle")}
            </h2>
          </div>
          <div className="grid gap-x-12 gap-y-0 sm:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  className="flex min-w-0 items-start gap-5 border-t border-border py-7"
                  key={feature.title}
                >
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                    <Icon aria-hidden="true" className="size-5" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <h3 className="font-heading text-xl font-semibold">{feature.title}</h3>
                    <p className="text-sm leading-6 text-muted-foreground">{feature.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6 border-t border-border pt-10 lg:grid-cols-[.45fr_1.55fr]">
          <div className="relative hidden min-h-56 overflow-hidden rounded-t-full bg-secondary p-9 text-primary lg:block">
            <Icons.secure aria-hidden="true" className="relative z-10 size-9 text-primary" />
            <CosmicArt
              className="pointer-events-none absolute right-[-64px] bottom-[-76px] w-72 opacity-75"
              variant="orbit"
            />
          </div>
          <div className="flex flex-col gap-5 lg:pl-8">
            <div className="flex flex-col gap-3">
              <h2 className="font-heading text-3xl font-semibold tracking-tight">
                {t("googleDataTitle")}
              </h2>
              <p className="leading-7 text-muted-foreground">{t("googleDataDescription")}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                {t("googleDataNoExtraAccess")}
              </p>
            </div>
            <Link
              className="w-fit rounded-md font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              to="/docs/privacy"
            >
              {t("readPrivacyPolicy")}
            </Link>
          </div>
        </section>

        <footer className="flex flex-col justify-between gap-4 border-t border-border py-6 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <span>{t("landingFooter")}</span>
          <nav aria-label={t("legalLinks")} className="flex flex-wrap gap-5">
            <Link className="hover:text-foreground hover:underline" to="/docs/privacy">
              {t("privacyPolicy")}
            </Link>
            <Link className="hover:text-foreground hover:underline" to="/docs/tos">
              {t("termsOfService")}
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
