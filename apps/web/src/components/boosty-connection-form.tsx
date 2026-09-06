import { useHydrated } from "@tanstack/react-router";
import { Button } from "@web/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@web/components/ui/dialog";
import { Input } from "@web/components/ui/input";
import { Kbd, KbdGroup } from "@web/components/ui/kbd";
import { useBoostyConnection } from "@web/hooks/chat-service";
import { getDevtoolsShortcut } from "@web/lib/devtools-shortcut";
import { createTranslator, useI18n } from "@web/lib/i18n";
import { resolveLocale } from "@web/lib/locale";
import { Fragment, useState, type FormEvent } from "react";

function BoostyInstructionText({ text }: { text: string }) {
  return text
    .split(
      /(\b(?:Local Storage|Application|Storage|Cookies|Settings|Advanced|auth|accessToken|refreshToken|_clientId|localStorage|Fn|F9)\b|Приложение|Хранилище|Настройки|Дополнения)/,
    )
    .map((part, index) => {
      if (index % 2 === 0) return part;
      if (part === "Fn" || part === "F9") return <Kbd key={index}>{part}</Kbd>;
      if (/^(auth|accessToken|refreshToken|_clientId|localStorage)$/.test(part)) {
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
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const connect = useBoostyConnection(onClose);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = accessToken.trim();
    if (!token || !refreshToken.trim() || !deviceId.trim() || connect.isPending) return;
    setAccessToken("");
    setRefreshToken("");
    setDeviceId("");
    connect.mutate({
      accessToken: token,
      refreshToken: refreshToken.trim(),
      deviceId: deviceId.trim(),
    });
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
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <label className="flex flex-col gap-1 text-sm" htmlFor="boosty-access-token">
            {t("boostyAccessToken")}
            <Input
              aria-describedby="boosty-token-storage"
              autoComplete="off"
              disabled={connect.isPending}
              id="boosty-access-token"
              maxLength={8192}
              onChange={(event) => setAccessToken(event.target.value)}
              required
              spellCheck={false}
              type="password"
              value={accessToken}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="boosty-refresh-token">
            <span>
              <BoostyInstructionText text={t("boostyRefreshToken")} />
            </span>
            <Input
              autoComplete="off"
              disabled={connect.isPending}
              id="boosty-refresh-token"
              maxLength={8192}
              onChange={(event) => setRefreshToken(event.target.value)}
              required
              spellCheck={false}
              type="password"
              value={refreshToken}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="boosty-device-id">
            <span>
              <BoostyInstructionText text={t("boostyDeviceId")} />
            </span>
            <Input
              autoComplete="off"
              disabled={connect.isPending}
              id="boosty-device-id"
              maxLength={200}
              onChange={(event) => setDeviceId(event.target.value)}
              required
              spellCheck={false}
              value={deviceId}
            />
          </label>
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
              disabled={
                !accessToken.trim() || !refreshToken.trim() || !deviceId.trim() || connect.isPending
              }
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
