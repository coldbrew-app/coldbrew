import { useConnectDonateStreamM } from "@web/hooks/api";
import { createI18n, useI18n } from "@web/lib/i18n";

import { WidgetConnectionForm } from "./widget-connection-form";

const i18n = createI18n({
  title: {
    en: "Connect donate.stream",
    ru: "Подключить donate.stream",
  },
  description: {
    en: "StreamBrew uses your alert widget address to receive new donations in real time. Earlier donations are not imported.",
    ru: "StreamBrew использует адрес виджета оповещений, чтобы получать новые донаты в реальном времени. Старые донаты не загружаются.",
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
    en: "Keep this address private: it grants access to incoming alert data. StreamBrew stores its credentials but never returns them to the browser.",
    ru: "Не публикуйте этот адрес: он даёт доступ к данным новых оповещений. StreamBrew хранит его реквизиты, но не возвращает их в браузер.",
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
  const connect = useConnectDonateStreamM();
  return (
    <WidgetConnectionForm
      fieldId="donate-stream-widget-url"
      isError={connect.isError}
      isPending={connect.isPending}
      onClose={onClose}
      onConnect={(widgetUrl, onSuccess) => connect.mutate({ widgetUrl }, { onSuccess })}
      onReset={() => connect.reset()}
      settingsURL="https://lk.donate.stream/widgets/alert/all"
      translate={t}
    />
  );
}
