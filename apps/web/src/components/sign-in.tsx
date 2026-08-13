import { signIn } from "@web/lib/auth-client";
import { useState } from "react";

import logo from "../../assets/logo.svg";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";

export default function SignIn() {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { t } = useI18n();

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7fb] p-6 text-[#242238]">
      <section className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-[#ebeaf1] bg-white p-8 shadow-xl shadow-violet-950/5">
        <div className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-[#292640]">
          <img alt="" className="h-6" src={logo} />
          omnistream
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("welcomeBack")}</h1>
          <p className="text-sm text-[#77758b]">{t("signInDescription")}</p>
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
