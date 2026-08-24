import { signIn } from "@web/lib/auth-client";
import { useState } from "react";

import productMark from "../../assets/logo.png";
import { useI18n } from "../lib/i18n";
import { CosmicArt } from "./cosmic-art";
import { Button } from "./ui/button";

export default function SignIn() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { t } = useI18n();

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background p-4 text-foreground sm:p-6">
      <div className="cosmic-grid pointer-events-none absolute inset-0 opacity-40" />
      <section className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-primary/20 bg-card shadow-2xl shadow-primary/15 lg:grid-cols-[1.15fr_.85fr]">
        <div className="cosmic-hero relative flex min-h-[360px] flex-col justify-between overflow-hidden p-7 text-white sm:p-10 lg:min-h-[600px]">
          <div className="relative z-10 flex items-center gap-2.5 font-heading text-2xl font-semibold tracking-tight">
            <img alt="" className="size-12 object-contain" src={productMark} />
            Coldbrew
          </div>
          <div className="relative z-10 flex max-w-md flex-col gap-3 pb-48 lg:pb-0">
            <span className="text-[10px] font-bold tracking-[0.18em] text-[#ffcf69] uppercase">
              {t("signInEyebrow")}
            </span>
            <h2 className="font-heading text-[clamp(34px,5vw,58px)] leading-[0.98] font-semibold tracking-tight">
              {t("orbitCaption")}
            </h2>
            <p className="text-sm leading-relaxed text-white/70">{t("signInStory")}</p>
          </div>
          <CosmicArt className="pointer-events-none absolute right-[-26px] bottom-[-22px] w-[330px]" />
        </div>
        <div className="flex flex-col justify-center gap-7 p-6 sm:p-10 lg:p-12">
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-4xl font-semibold tracking-tight">
              {t("welcomeBack")}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("signInDescription")}
            </p>
          </div>
          <Button
            className="h-11 w-full rounded-xl shadow-lg shadow-primary/20"
            disabled={isSigningIn}
            onClick={async () => {
              setIsSigningIn(true);
              const callbackURL = new URL("/integrations", window.location.origin).href;
              await signIn.social({ provider: "google", callbackURL });
            }}
            size="lg"
          >
            {t(isSigningIn ? "redirecting" : "continueWithGoogle")}
          </Button>
        </div>
      </section>
    </main>
  );
}
