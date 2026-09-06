import { rurl } from "@lebedevna/readonly-url";
import { Link } from "@tanstack/react-router";
import { signIn } from "@web/lib/auth-client";
import { useState } from "react";

import productMark from "../../assets/logo.png";
import { useI18n } from "../lib/i18n";
import { CosmicArt } from "./cosmic-art";
import { Icons } from "./icons";
import { Button } from "./ui/button";

export default function SignIn() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { t } = useI18n();

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
          Coldbrew
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
              <span className="text-xs leading-5 text-muted-foreground">
                {t("landingSignInNote")}
              </span>
            </div>
          </div>
          <div className="coffee-observatory relative flex min-h-[560px] flex-col justify-between overflow-hidden px-7 pt-28 pb-8 text-[#fff8ed] sm:min-h-[620px] sm:px-10 sm:pb-10">
            <div className="relative z-10 flex max-w-sm flex-col gap-3">
              <h2 className="max-w-72 font-heading text-2xl leading-tight font-medium sm:text-3xl">
                {t("orbitCaption")}
              </h2>
              <p className="max-w-64 text-sm leading-6 text-[#e3c8b6]">{t("signInStory")}</p>
            </div>
            <div className="relative z-10 flex flex-col gap-2 self-start border-t border-[#e4b88b]/35 pt-4">
              <span className="text-sm font-medium text-white/90">{t("landingWorkflow")}</span>
            </div>
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
            <p className="leading-7 text-muted-foreground">{t("landingFeaturesDescription")}</p>
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
