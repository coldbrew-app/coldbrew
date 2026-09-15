import { useConnectTourniquetM } from "@web/hooks/api";
import { createI18n, useI18n } from "@web/lib/i18n";

import { WidgetConnectionForm } from "./widget-connection-form";

const i18n = createI18n({
  title: { en: "Connect Tourniquet", ru: "Подключить Турникет" },
  description: {
    en: "StreamBrew receives new paid donations through your alert widget. Tourniquet does not provide past or missed donations.",
    ru: "StreamBrew получает новые оплаченные донаты через виджет оповещений. Турникет не отдаёт старые или пропущенные донаты.",
  },
  widgetURLLabel: { en: "Donation alert link", ru: "Ссылка оповещения о донатах" },
  widgetURLPlaceholder: {
    en: "https://tourniquet.app/widgets/alert/…",
    ru: "https://tourniquet.app/widgets/alert/…",
  },
  widgetURLHelp: {
    en: "Copy the full “Your donation alert link” from Profile → Widgets.",
    ru: "Скопируйте целиком «Your donation alert link» из раздела «Профиль → Виджеты».",
  },
  openWidgetSettings: {
    en: "Open Tourniquet widgets",
    ru: "Открыть виджеты Турникета",
  },
  widgetURLSafety: {
    en: "Keep this link private: it grants access to incoming alert data. StreamBrew stores the token on the donations service and never returns it to the browser.",
    ru: "Не публикуйте эту ссылку: она даёт доступ к данным новых оповещений. StreamBrew хранит токен в сервисе донатов и не возвращает его в браузер.",
  },
  invalidWidgetURL: {
    en: "Could not connect. Copy the full current donation alert link from Tourniquet.",
    ru: "Не удалось подключиться. Скопируйте из Турникета целиком актуальную ссылку оповещения о донатах.",
  },
  cancel: { en: "Cancel", ru: "Отмена" },
  connect: { en: "Connect", ru: "Подключить" },
  connecting: { en: "Connecting…", ru: "Подключаем…" },
});

export function TourniquetConnectionForm({ onClose }: { onClose: () => void }) {
  const { t } = useI18n(i18n);
  const connect = useConnectTourniquetM();
  return (
    <WidgetConnectionForm
      copy={{
        cancel: t("cancel"),
        connect: t("connect"),
        connecting: t("connecting"),
        description: t("description"),
        invalidWidgetURL: t("invalidWidgetURL"),
        openWidgetSettings: t("openWidgetSettings"),
        title: t("title"),
        widgetURLHelp: t("widgetURLHelp"),
        widgetURLLabel: t("widgetURLLabel"),
        widgetURLPlaceholder: t("widgetURLPlaceholder"),
        widgetURLSafety: t("widgetURLSafety"),
      }}
      fieldId="tourniquet-widget-url"
      isError={connect.isError}
      isPending={connect.isPending}
      onClose={onClose}
      onConnect={(widgetUrl, onSuccess) => connect.mutate({ widgetUrl }, { onSuccess })}
      onReset={() => connect.reset()}
      settingsURL="https://tourniquet.app/profile/widgets"
    />
  );
}
