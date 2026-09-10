import { useHydrated } from "@tanstack/react-router";
import { Button } from "@web/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@web/components/ui/dialog";
import { Input } from "@web/components/ui/input";
import { Kbd, KbdGroup } from "@web/components/ui/kbd";
import { Switch } from "@web/components/ui/switch";
import { useBoostyConnection } from "@web/hooks/chat-service";
import { parseBoostyAuth } from "@web/lib/boosty-auth";
import { getDevtoolsShortcut } from "@web/lib/devtools-shortcut";
import { createI18n, createTranslator, useI18n } from "@web/lib/i18n";
import { resolveLocale } from "@web/lib/locale";
import { Fragment, useState, type FormEvent } from "react";

const i18n = createI18n({
  boostyConnectTitle: {
    en: "Connect Boosty",
    ru: "Подключить Boosty",
  },
  boostyAuth: {
    en: "auth",
    ru: "auth",
  },
  boostyAuthInvalid: {
    en: "Could not read auth. Copy its entire value from Boosty and paste it again.",
    ru: "Не удалось прочитать auth. Скопируйте его значение из Boosty целиком и вставьте снова.",
  },
  boostyDeviceId: {
    en: "_clientId",
    ru: "_clientId",
  },
  boostyConnecting: {
    en: "Connecting…",
    ru: "Подключаем…",
  },
  boostyTokenHelp: {
    en: "Read-only connection through an unofficial API. Follow these steps to copy your connection details.",
    ru: "Подключение только для чтения через неофициальный API. Скопируйте данные для подключения по инструкции ниже.",
  },
  devtoolsApplication: {
    en: "Application",
    ru: "Приложение",
  },
  devtoolsStorage: {
    en: "Storage",
    ru: "Хранилище",
  },
  boostyTokenStepSignIn: {
    en: "Create a separate browser profile for Coldbrew (without browser sync). In that profile, sign in to your account at",
    ru: "Создайте отдельный профиль браузера для Coldbrew без синхронизации. В этом профиле войдите в свой аккаунт на сайте",
  },
  boostyDedicatedSession: {
    en: "I used a separate browser profile and will close its Boosty tabs after copying the credentials",
    ru: "Я использовал отдельный профиль браузера и закрою вкладки Boosty после копирования данных",
  },
  boostyTokenStepFind: {
    en: ({ application, storage }: { application: string; storage: string }) =>
      `On the Boosty tab, open developer tools from the browser menu → ${application} (${storage} in Firefox or Safari). Find the auth entry in Cookies or Local Storage for Boosty.`,
    ru: ({ application, storage }: { application: string; storage: string }) =>
      `На вкладке Boosty откройте инструменты разработчика через меню браузера → ${application} (${storage} в Firefox или Safari). Найдите запись auth в Cookies или Local Storage для Boosty.`,
  },
  boostyTokenStepChromium: {
    en: ({ shortcut, panel }: { shortcut: string; panel: string }) =>
      `On the Boosty tab, press ${shortcut} to open developer tools, then select ${panel} (it may be in the hidden tabs menu). Find the auth entry under Cookies or Local Storage → https://boosty.to.`,
    ru: ({ shortcut, panel }: { shortcut: string; panel: string }) =>
      `На вкладке Boosty нажмите ${shortcut}, чтобы открыть инструменты разработчика, затем выберите ${panel}. Вкладка может быть в меню скрытых вкладок. Найдите запись auth в Cookies или Local Storage → https://boosty.to.`,
  },
  boostyTokenStepFirefox: {
    en: ({ shortcut, panel }: { shortcut: string; panel: string }) =>
      `On the Boosty tab, press ${shortcut} to open ${panel}. If your keyboard uses F9 for a system action, also hold Fn. Find the auth entry under Cookies or Local Storage → https://boosty.to.`,
    ru: ({ shortcut, panel }: { shortcut: string; panel: string }) =>
      `На вкладке Boosty нажмите ${shortcut}, чтобы открыть ${panel}. Если F9 выполняет системное действие, дополнительно удерживайте Fn. Найдите запись auth в Cookies или Local Storage → https://boosty.to.`,
  },
  boostyTokenStepSafari: {
    en: ({ shortcut, panel }: { shortcut: string; panel: string }) =>
      `In Safari → Settings → Advanced, enable “Show features for web developers”. On the Boosty tab, press ${shortcut}, then select ${panel}. Find the auth entry under Cookies or Local Storage → https://boosty.to.`,
    ru: ({ shortcut, panel }: { shortcut: string; panel: string }) =>
      `В Safari → Настройки → Дополнения включите функции для веб-разработчиков. На вкладке Boosty нажмите ${shortcut}, затем выберите ${panel}. Найдите запись auth в Cookies или Local Storage → https://boosty.to.`,
  },
  boostyTokenStepMobile: {
    en: ({ application, storage }: { application: string; storage: string }) =>
      `Get the token in a desktop browser: open Boosty there, then developer tools → ${application} (${storage} in Firefox or Safari). Find the auth entry under Cookies or Local Storage for Boosty.`,
    ru: ({ application, storage }: { application: string; storage: string }) =>
      `Получите токен в браузере на компьютере: откройте там Boosty, затем инструменты разработчика → ${application} (${storage} в Firefox или Safari). Найдите запись auth в Cookies или Local Storage для Boosty.`,
  },
  boostyTokenStepCopy: {
    en: "Copy the entire value of auth into the auth field below without changing it. Copy _clientId from the same browser’s Cookies or Local Storage into the _clientId field.",
    ru: "Скопируйте значение auth целиком и без изменений в поле auth ниже. В поле _clientId вставьте значение _clientId из Cookies или Local Storage того же браузера.",
  },
  boostyTokenStorage: {
    en: "Close Boosty tabs in that profile without signing out. Use your usual profile to visit Boosty. Sharing one session with Coldbrew causes sign-outs and connection errors when either side renews it. Tokens are encrypted and renewed automatically.",
    ru: "Закройте вкладки Boosty в отдельном профиле, не нажимая «Выйти». Пользуйтесь Boosty в обычном профиле. Общая с Coldbrew сессия приводит к выходам из аккаунта и ошибкам при обновлении токенов. Токены хранятся зашифрованными и обновляются автоматически.",
  },
  boostyConnectError: {
    en: "Could not connect Boosty. Check that the token is current and belongs to an account with a blog, then try again. Also check the channel limit and service availability.",
    ru: "Не удалось подключить Boosty. Проверьте, что токен действителен и принадлежит аккаунту с блогом, затем повторите попытку. Также проверьте лимит каналов и доступность сервиса.",
  },
  cancel: {
    en: "Cancel",
    ru: "Отменить",
  },
});

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
  const { t, locale } = useI18n(i18n);
  const hydrated = useHydrated();
  const devtools = hydrated
    ? getDevtoolsShortcut(navigator.userAgent, navigator.maxTouchPoints)
    : getDevtoolsShortcut("");
  const browserLanguage = hydrated ? navigator.language : undefined;
  const browserT = createTranslator(resolveLocale(undefined, browserLanguage || locale), i18n);
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
