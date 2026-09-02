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
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-background px-4 text-foreground sm:px-6">
      <div className="cosmic-grid pointer-events-none absolute inset-0 opacity-30" />

      <header className="relative z-10 flex w-full max-w-6xl items-center justify-between gap-4 py-5 sm:py-7">
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

      <div className="relative z-10 flex w-full max-w-6xl flex-col gap-16 pb-8 sm:gap-20 sm:pb-12">
        <section className="grid overflow-hidden rounded-[2rem] border border-primary/20 bg-card shadow-2xl shadow-primary/15 lg:grid-cols-[1.08fr_.92fr]">
          <div className="flex flex-col justify-center gap-6 p-7 sm:p-10 lg:p-14">
            <div className="flex max-w-2xl flex-col gap-4">
              <span className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
                {t("signInEyebrow")}
              </span>
              <h1 className="font-heading text-[clamp(2.6rem,7vw,5.25rem)] leading-[0.96] font-semibold tracking-[-0.035em]">
                {t("landingHeadline")}
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                {t("landingDescription")}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Button
                aria-busy={isSigningIn}
                className="h-11 rounded-xl px-5 shadow-lg shadow-primary/20"
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
          <div className="cosmic-hero relative flex min-h-[420px] flex-col justify-between overflow-hidden p-7 text-white sm:min-h-[500px] sm:p-10 lg:min-h-[620px]">
            <div className="relative z-10 flex max-w-sm flex-col gap-3">
              <span className="text-[10px] font-bold tracking-[0.18em] text-[#ffcf69] uppercase">
                {t("landingSignalEyebrow")}
              </span>
              <h2 className="font-heading text-3xl leading-tight font-semibold sm:text-4xl">
                {t("orbitCaption")}
              </h2>
              <p className="text-sm leading-6 text-white/70">{t("signInStory")}</p>
            </div>
            <div className="relative z-10 flex flex-col gap-2 self-start rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
              <span className="text-[10px] font-bold tracking-[0.16em] text-[#ffcf69] uppercase">
                {t("landingWorkflowEyebrow")}
              </span>
              <span className="text-sm font-medium text-white/90">{t("landingWorkflow")}</span>
            </div>
            <CosmicArt className="pointer-events-none absolute right-[-38px] bottom-[-34px] w-[360px] sm:w-[430px]" />
          </div>
        </section>

        <section aria-labelledby="landing-features" className="flex flex-col gap-7">
          <div className="flex max-w-2xl flex-col gap-3">
            <span className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
              {t("landingFeaturesEyebrow")}
            </span>
            <h2
              className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl"
              id="landing-features"
            >
              {t("landingFeaturesTitle")}
            </h2>
            <p className="leading-7 text-muted-foreground">{t("landingFeaturesDescription")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  className="cosmic-panel flex min-w-0 flex-col gap-4 p-6 sm:p-7"
                  key={feature.title}
                >
                  <div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
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

        <section className="grid overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm lg:grid-cols-[.75fr_1.25fr]">
          <div className="cosmic-hero relative min-h-56 overflow-hidden p-7 text-white sm:p-9">
            <Icons.secure aria-hidden="true" className="relative z-10 size-9 text-[#ffcf69]" />
            <CosmicArt
              className="pointer-events-none absolute right-[-64px] bottom-[-76px] w-72 opacity-75"
              variant="orbit"
            />
          </div>
          <div className="flex flex-col gap-5 p-7 sm:p-10">
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold tracking-[0.18em] text-primary uppercase">
                {t("googleDataEyebrow")}
              </span>
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
