import { signIn } from "@web/lib/auth-client";
import { useState } from "react";

import logo from "../../assets/logo.svg";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";

export default function SignIn() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { t } = useI18n();

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground sm:p-6">
      <section className="flex w-full max-w-sm flex-col gap-6 rounded-3xl border border-border bg-card p-5 shadow-xl shadow-primary/10 sm:p-8">
        <div className="flex items-center gap-2.5 font-heading text-2xl font-semibold tracking-tight text-foreground">
          <img alt="" className="h-6" src={logo} />
          coldbrew
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("welcomeBack")}</h1>
          <p className="text-sm text-muted-foreground">{t("signInDescription")}</p>
        </div>
        <Button
          className="w-full"
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
      </section>
    </main>
  );
}
