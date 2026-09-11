import { useConnectDonateStreamM } from "@web/hooks/api";
import { createI18n, useI18n } from "@web/lib/i18n";
import { useState, type FormEvent } from "react";

import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

const i18n = createI18n({
  title: {
    en: "Connect donate.stream",
    ru: "Подключить donate.stream",
  },
  description: {
    en: "Coldbrew uses your alert widget address to receive new donations in real time. Earlier donations are not imported.",
    ru: "Coldbrew использует адрес виджета оповещений, чтобы получать новые донаты в реальном времени. Старые донаты не загружаются.",
  },
  widgetURLLabel: {
    en: "Alert widget address",
    ru: "Адрес виджета оповещений",
  },
  widgetURLPlaceholder: {
    en: "https://donate.stream/widget-alert?uid=…&token=…",
    ru: "https://donate.stream/widget-alert?uid=…&token=…",
  },
  widgetURLHelp: {
    en: "Choose a group, then show and copy the full widget address.",
    ru: "Выберите группу, затем покажите и скопируйте адрес виджета целиком.",
  },
  openWidgetSettings: {
    en: "Open alert widgets in donate.stream",
    ru: "Открыть виджеты оповещений в donate.stream",
  },
  widgetURLSafety: {
    en: "Keep this address private: it grants access to incoming alert data. Coldbrew stores its credentials but never returns them to the browser.",
    ru: "Не публикуйте этот адрес: он даёт доступ к данным новых оповещений. Coldbrew хранит его реквизиты, но не возвращает их в браузер.",
  },
  invalidWidgetURL: {
    en: "Could not connect. Check that you copied the full current alert widget address.",
    ru: "Не удалось подключиться. Проверьте, что адрес виджета оповещений скопирован целиком и ещё действует.",
  },
  cancel: {
    en: "Cancel",
    ru: "Отмена",
  },
  connect: {
    en: "Connect",
    ru: "Подключить",
  },
  connecting: {
    en: "Connecting…",
    ru: "Подключаем…",
  },
});

export function DonateStreamConnectionForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(i18n);
  const [widgetURL, setWidgetURL] = useState("");
  const connect = useConnectDonateStreamM();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = widgetURL.trim();
    if (url.length === 0 || connect.isPending) return;
    connect.mutate(
      { widgetUrl: url },
      {
        onSuccess() {
          setWidgetURL("");
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <div className="flex flex-col gap-2">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </div>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Field data-invalid={connect.isError || undefined}>
            <FieldLabel htmlFor="donate-stream-widget-url">{t("widgetURLLabel")}</FieldLabel>
            <Input
              aria-invalid={connect.isError || undefined}
              autoComplete="off"
              id="donate-stream-widget-url"
              maxLength={4096}
              onChange={(event) => {
                setWidgetURL(event.target.value);
                connect.reset();
              }}
              placeholder={t("widgetURLPlaceholder")}
              spellCheck={false}
              type="url"
              value={widgetURL}
            />
            <FieldDescription>
              <a
                className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                href="https://lk.donate.stream/widgets/alert/all"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("openWidgetSettings")}
                <Icons.externalLink aria-hidden="true" size={12} />
              </a>{" "}
              {t("widgetURLHelp")}
            </FieldDescription>
            {connect.isError && <FieldError>{t("invalidWidgetURL")}</FieldError>}
          </Field>
          <div className="flex items-start gap-2 rounded-xl bg-muted/70 p-3 text-xs leading-relaxed text-muted-foreground">
            <Icons.secure aria-hidden="true" className="shrink-0 text-primary" size={15} />
            <p>{t("widgetURLSafety")}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={connect.isPending} onClick={onClose} type="button" variant="outline">
              {t("cancel")}
            </Button>
            <Button disabled={widgetURL.trim().length === 0 || connect.isPending} type="submit">
              {t(connect.isPending ? "connecting" : "connect")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
