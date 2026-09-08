import { useHydrated } from "@tanstack/react-router";
import { Button } from "@web/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@web/components/ui/dialog";
import { Input } from "@web/components/ui/input";
import { Kbd, KbdGroup } from "@web/components/ui/kbd";
import { Switch } from "@web/components/ui/switch";
import { useBoostyConnection } from "@web/hooks/chat-service";
import { parseBoostyAuth } from "@web/lib/boosty-auth";
import { getDevtoolsShortcut } from "@web/lib/devtools-shortcut";
import { createTranslator, useI18n } from "@web/lib/i18n";
import { resolveLocale } from "@web/lib/locale";
import { Fragment, useState, type FormEvent } from "react";

function BoostyInstructionText({ text }: { text: string }) {
  return text
    .split(
      /(\b(?:Local Storage|Application|Storage|Cookies|Settings|Advanced|auth|_clientId|localStorage|Fn|F9)\b|Приложение|Хранилище|Настройки|Дополнения)/,
    )
    .map((part, index) => {
      if (index % 2 === 0) return part;
      if (part === "Fn" || part === "F9") return <Kbd key={index}>{part}</Kbd>;
      if (/^(auth|_clientId|localStorage)$/.test(part)) {
        return (
          <code
            className="rounded-sm bg-secondary px-1 py-0.5 font-mono text-[0.9em] text-secondary-foreground"
            key={index}
          >
            {part}
          </code>
        );
      }
      return (
        <strong className="font-semibold text-foreground" key={index}>
          {part}
        </strong>
      );
    });
}

export function BoostyConnectionForm({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const hydrated = useHydrated();
  const devtools = hydrated
    ? getDevtoolsShortcut(navigator.userAgent, navigator.maxTouchPoints)
    : getDevtoolsShortcut("");
  const browserLanguage = hydrated ? navigator.language : undefined;
  const browserT = createTranslator(resolveLocale(undefined, browserLanguage || locale));
  const panels = {
    application: browserT("devtoolsApplication"),
    storage: browserT("devtoolsStorage"),
  };
  const tokenHelp = (() => {
    switch (devtools.browser) {
      case "chromium":
        return t("boostyTokenStepChromium", {
          shortcut: devtools.shortcut,
          panel: panels.application,
        });
      case "firefox":
        return t("boostyTokenStepFirefox", { shortcut: devtools.shortcut, panel: panels.storage });
      case "safari":
        return t("boostyTokenStepSafari", { shortcut: devtools.shortcut, panel: panels.storage });
      case "mobile":
        return t("boostyTokenStepMobile", panels);
      default:
        return t("boostyTokenStepFind", panels);
    }
  })();
  const [dedicatedSession, setDedicatedSession] = useState(false);
  const [auth, setAuth] = useState("");
  const [authInvalid, setAuthInvalid] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const connect = useBoostyConnection(onClose);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dedicatedSession || !auth.trim() || !deviceId.trim() || connect.isPending) return;
    let credentials;
    try {
      credentials = parseBoostyAuth(auth);
    } catch {
      setAuthInvalid(true);
      return;
    }
    setAuthInvalid(false);
    setAuth("");
    setDeviceId("");
    connect.mutate({ ...credentials, dedicatedSession, deviceId: deviceId.trim() });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !connect.isPending) onClose();
      }}
    >
      <DialogContent>
        <div className="flex flex-col gap-2">
          <DialogTitle>{t("boostyConnectTitle")}</DialogTitle>
          <DialogDescription>{t("boostyTokenHelp")}</DialogDescription>
        </div>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm leading-relaxed">
          <li>
            {t("boostyTokenStepSignIn")}{" "}
            <a
              className="rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
              href="https://boosty.to"
              target="_blank"
              rel="noreferrer"
            >
              boosty.to
            </a>
            .
          </li>
          <li>
            {devtools.shortcut ? (
              tokenHelp.split(devtools.shortcut).map((part, index) => (
                <Fragment key={index}>
                  {index > 0 && (
                    <KbdGroup className="align-baseline whitespace-nowrap">
                      {devtools.shortcut.split(" + ").map((key, keyIndex) => (
                        <Fragment key={key}>
                          {keyIndex > 0 && <span>+</span>}
                          <Kbd>{key}</Kbd>
                        </Fragment>
                      ))}
                    </KbdGroup>
                  )}
                  <BoostyInstructionText text={part} />
                </Fragment>
              ))
            ) : (
              <BoostyInstructionText text={tokenHelp} />
            )}
          </li>
          <li>
            <BoostyInstructionText text={t("boostyTokenStepCopy")} />
          </li>
        </ol>
        <form autoComplete="off" className="flex flex-col gap-4" onSubmit={submit}>
          <label
            className="flex items-start gap-3 text-sm leading-relaxed"
            htmlFor="boosty-dedicated-session"
          >
            <Switch
              id="boosty-dedicated-session"
              checked={dedicatedSession}
              onCheckedChange={setDedicatedSession}
              disabled={connect.isPending}
            />
            <span>{t("boostyDedicatedSession")}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="boosty-device-id">
            <span>
              <BoostyInstructionText text={t("boostyDeviceId")} />
            </span>
            <Input
              autoComplete="off"
              autoCapitalize="none"
              data-1p-ignore
              data-lpignore="true"
              disabled={connect.isPending}
              id="boosty-device-id"
              maxLength={200}
              onChange={(event) => setDeviceId(event.target.value)}
              required
              spellCheck={false}
              value={deviceId}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="boosty-auth">
            <span>
              <BoostyInstructionText text={t("boostyAuth")} />
            </span>
            <Input
              aria-describedby={
                authInvalid ? "boosty-auth-error boosty-token-storage" : "boosty-token-storage"
              }
              aria-invalid={authInvalid}
              autoComplete="off"
              autoCapitalize="none"
              data-1p-ignore
              data-lpignore="true"
              disabled={connect.isPending}
              id="boosty-auth"
              onChange={(event) => {
                setAuth(event.target.value);
                setAuthInvalid(false);
              }}
              required
              spellCheck={false}
              // Tokens are not passwords; keep them masked without login-form heuristics.
              className="[-webkit-text-security:disc]"
              type="text"
              value={auth}
            />
          </label>
          {authInvalid && (
            <p className="text-xs text-destructive" id="boosty-auth-error" role="alert">
              {t("boostyAuthInvalid")}
            </p>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground" id="boosty-token-storage">
            {t("boostyTokenStorage")}
          </p>
          {connect.isError && (
            <p className="text-xs text-destructive" role="alert">
              {t("boostyConnectError")}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={!dedicatedSession || !auth.trim() || !deviceId.trim() || connect.isPending}
              type="submit"
            >
              {connect.isPending ? t("boostyConnecting") : t("boostyConnectTitle")}
            </Button>
            <Button disabled={connect.isPending} onClick={onClose} type="button" variant="ghost">
              {t("cancel")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
