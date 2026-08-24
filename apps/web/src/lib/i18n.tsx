import { useRouter } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { localeCookieName, locales, type Locale, resolveLocale } from "./locale";

export { locales, resolveLocale };
export type { Locale };

const en = {
  overview: "Overview",
  donations: "Donations",
  integrations: "Integrations",
  alerts: "Alerts",
  settings: "Settings",
  queueCurrency: "Queue currency",
  queueCurrencyDescription: "Videos and queue thresholds use this currency.",
  changeQueueCurrency: "Change currency",
  queueCurrencyRate: ({ larger, smaller }: { larger: string; smaller: string }) =>
    `1 ${larger} = amount in ${smaller}`,
  queueCurrencyWarning:
    "Changing currency converts existing video amounts and queue thresholds. Videos keep their current queue.",
  enterExchangeRate: "Enter an exchange rate greater than zero.",
  underConstruction: "Under construction",
  signOut: "Sign out",
  logOut: "Log out",
  switchToLightMode: "Switch to light mode",
  switchToDarkMode: "Switch to dark mode",
  language: "Language",
  openNavigation: "Open navigation",
  english: "English",
  russian: "Russian",
  activeDevelopment:
    "Coldbrew is under active development. Breaking changes and data loss are possible.",
  dismissDevelopmentWarning: "Dismiss development warning",
  greeting: ({ name }: { name: string }) => `Good evening, ${name}`,
  streamUpdate: "An overview of your stream.",
  streamStatistics: "Stream stats",
  totalReceived: "Total received",
  averageDonation: "Average donation",
  versusPreviousPeriod: "vs. the previous period",
  acrossPlatforms: "Across connected platforms",
  recentActivity: "Recent activity",
  everyDonation: "All your donations, in one place.",
  viewAll: "View all",
  donationTrends: "Donation trends",
  earningsOverTime: "How your earnings have changed over time.",
  revenue: "Revenue",
  setupNeeded: "Connection required",
  automaticSync: "Donations sync automatically.",
  connectAllDonations: "Connect DonationAlerts to see all your donations here.",
  manage: "Manage",
  readyForOverlay: "Need an overlay for your stream?",
  overlayDescription: "Show donations on stream with a browser source.",
  createOverlay: "Create overlay",
  welcomeBack: "Welcome back",
  signInDescription: "Sign in to manage your stream from one place.",
  redirecting: "Redirecting…",
  continueWithGoogle: "Continue with Google",
  integrationsDescription: "Connect services to keep all your donations in one place.",
  connected: "Connected",
  notConnected: "Not connected",
  donationsSyncing: "New DonationAlerts donations sync automatically.",
  importDonations: "Automatically import donations from DonationAlerts.",
  disconnecting: "Disconnecting…",
  disconnect: "Disconnect",
  connectDonationAlerts: "Connect DonationAlerts",
  secureAuthorization: "Sign in to DonationAlerts to securely grant Coldbrew access.",
  moreIntegrationsSoon: "More integrations are coming soon.",
  donationContent: "Donations section",
  videos: "Videos",
  allDonations: "All donations",
  videoQueue: "Video queue",
  browseDonations: "Browse and search your supporters’ donations.",
  videosForStream: "Videos shared by your supporters, ready to play on stream.",
  searchDonations: "Search donations",
  searchBySupporter: "Search by supporter name or message...",
  dateRange: "Date range",
  allTime: "All time",
  last7Days: "Last 7 days",
  last30Days: "Last 30 days",
  loadingDonations: "Loading donations",
  dataLoadError: "Couldn't load data",
  dataLoadErrorDescription: "Check your connection and try again.",
  tryAgain: "Try again",
  retrying: "Retrying…",
  loadingAuthorization: "Loading authorization…",
  authorizationUnavailable: "Authorization is unavailable",
  noMatchingDonations: "No results found",
  noDonationsYet: "No donations yet",
  tryAnotherSearch: "Try a different search or clear it.",
  donationsWillAppear: "New donations will appear here.",
  all: "All",
  notWatched: "Not watched",
  watched: "Watched",
  saved: "Saved",
  loadingVideoQueue: "Loading video queue",
  noVideos: "No videos",
  noVideosInQueue: "No videos in the queue",
  noFilteredVideos: ({ status }: { status: string }) => `No ${status} videos`,
  filteredVideosWillAppear: "Videos matching this filter will appear here.",
  videoLinksWillAppear: "Video links from donations will appear here.",
  videoStatusFilters: "Video status filters",
  queues: "Queues",
  minimumDonation: "Minimum donation per video minute.",
  loadingVideoPriorities: "Loading video priorities",
  noQueuesYet: "No queues yet.",
  selectQueueFilter: ({ label }: { label: string }) => `Select ${label} queue filter`,
  editQueue: "Edit queue",
  cancelEditing: "Cancel editing",
  name: "Name",
  minimumAmountPerMinute: "Minimum amount per minute",
  enterQueueName: "Enter a queue name.",
  enterMinimumAmount: "Enter a minimum amount.",
  enterAmountZeroOrMore: "Enter an amount of zero or more.",
  savingQueue: "Saving queue",
  saveQueue: "Save queue",
  publicVideoQueueSlug: "Public video queue handle",
  slugHelp: "After @, use 3–47 lowercase letters, numbers, or hyphens.",
  slugInvalid: "After @, use 3–47 lowercase letters, numbers, or hyphens.",
  saving: "Saving…",
  save: "Save",
  copied: "Copied",
  copy: "Copy",
  anonymous: "Anonymous",
  sentDonation: "A donation was sent",
  youtubeVideoFrom: ({ author }: { author: string }) => `YouTube video from ${author}`,
  minutes: ({ count }: { count: number }) => `${count} min`,
  perMinute: "min",
  unknownDuration: "Duration unavailable",
  editVideoDetails: "Edit video details",
  amount: "Amount",
  durationMinutes: "Duration, min",
  enterPriorityAmount: "Enter a priority amount.",
  donationAmountHelp: "The donation amount determines the video’s queue position.",
  enterDuration: "Enter a duration.",
  enterWholeMinutes: "Enter a whole number of minutes.",
  durationHelp: "The video length in whole minutes determines its queue position.",
  markVideoWatched: "Mark video as watched",
  markVideoNotWatched: "Mark video as not watched",
  saveVideo: "Save video",
  removeVideoSaved: "Remove video from saved",
  watchedOn: ({ date }: { date: string }) => `Watched ${date}`,
  savedOn: ({ date }: { date: string }) => `Saved ${date}`,
  videoQueueBy: ({ slug }: { slug: string }) => `Video queue: ${slug}`,
  videosSharedBySupporters: "Videos supporters added through donations.",
  queueNotFound: "Queue not found",
  sharedQueueUnavailable: "This video queue is unavailable.",
} as const;

export type TranslationKey = keyof typeof en;

type TranslationContract = {
  [Key in TranslationKey]: (typeof en)[Key] extends (...args: infer Args) => string
    ? (...args: Args) => string
    : string;
};

function defineTranslations<const Translation extends TranslationContract>(
  translation: Translation & Record<Exclude<keyof Translation, TranslationKey>, never>,
) {
  return translation;
}

const ru = defineTranslations({
  overview: "Обзор",
  donations: "Донаты",
  integrations: "Интеграции",
  alerts: "Оповещения",
  settings: "Настройки",
  queueCurrency: "Валюта очереди",
  queueCurrencyDescription: "Видео и пороги очередей рассчитываются в этой валюте.",
  changeQueueCurrency: "Изменить валюту",
  queueCurrencyRate: ({ larger, smaller }: { larger: string; smaller: string }) =>
    `1 ${larger} = количество в ${smaller}`,
  queueCurrencyWarning:
    "При смене валюты суммы видео и пороги очередей пересчитаются. Видео останутся в текущих очередях.",
  enterExchangeRate: "Введите курс больше нуля.",
  underConstruction: "В разработке",
  signOut: "Выйти",
  logOut: "Выйти",
  switchToLightMode: "Включить светлую тему",
  switchToDarkMode: "Включить тёмную тему",
  language: "Язык",
  openNavigation: "Открыть навигацию",
  english: "Английский",
  russian: "Русский",
  activeDevelopment:
    "Coldbrew находится в активной разработке. Возможны несовместимые изменения и потеря данных.",
  dismissDevelopmentWarning: "Закрыть предупреждение о разработке",
  greeting: ({ name }: { name: string }) => `Добрый вечер, ${name}`,
  streamUpdate: "Главное по вашему стриму.",
  streamStatistics: "Статистика стрима",
  totalReceived: "Всего получено",
  averageDonation: "Средний донат",
  versusPreviousPeriod: "по сравнению с прошлым периодом",
  acrossPlatforms: "По всем подключённым платформам",
  recentActivity: "Последняя активность",
  everyDonation: "Все донаты — в одном месте.",
  viewAll: "Посмотреть все",
  donationTrends: "Динамика донатов",
  earningsOverTime: "Как менялся ваш доход.",
  revenue: "Доход",
  setupNeeded: "Требуется подключение",
  automaticSync: "Донаты синхронизируются автоматически.",
  connectAllDonations: "Подключите DonationAlerts, чтобы видеть все донаты здесь.",
  manage: "Управлять",
  readyForOverlay: "Нужен оверлей для стрима?",
  overlayDescription: "Выведите донаты на стрим через браузерный источник.",
  createOverlay: "Создать оверлей",
  welcomeBack: "С возвращением",
  signInDescription: "Войдите, чтобы управлять стримом из одного места.",
  redirecting: "Перенаправление…",
  continueWithGoogle: "Продолжить с Google",
  integrationsDescription: "Подключайте сервисы, чтобы все донаты были в одном месте.",
  connected: "Подключено",
  notConnected: "Не подключено",
  donationsSyncing: "Новые донаты из DonationAlerts синхронизируются автоматически.",
  importDonations: "Автоматически импортируйте донаты из DonationAlerts.",
  disconnecting: "Отключение…",
  disconnect: "Отключить",
  connectDonationAlerts: "Подключить DonationAlerts",
  secureAuthorization: "Войдите в DonationAlerts и безопасно предоставьте Coldbrew доступ.",
  moreIntegrationsSoon: "Скоро появятся другие интеграции.",
  donationContent: "Раздел донатов",
  videos: "Видео",
  allDonations: "Все донаты",
  videoQueue: "Очередь видео",
  browseDonations: "Просматривайте и ищите донаты зрителей.",
  videosForStream: "Видео от зрителей, готовые к показу на стриме.",
  searchDonations: "Поиск донатов",
  searchBySupporter: "Поиск по имени зрителя или сообщению...",
  dateRange: "Период",
  allTime: "За всё время",
  last7Days: "Последние 7 дней",
  last30Days: "Последние 30 дней",
  loadingDonations: "Загрузка донатов",
  dataLoadError: "Не удалось загрузить данные",
  dataLoadErrorDescription: "Проверьте подключение и попробуйте ещё раз.",
  tryAgain: "Попробовать снова",
  retrying: "Повторная загрузка…",
  loadingAuthorization: "Загрузка авторизации…",
  authorizationUnavailable: "Авторизация недоступна",
  noMatchingDonations: "Ничего не найдено",
  noDonationsYet: "Донатов пока нет",
  tryAnotherSearch: "Попробуйте другой запрос или очистите поиск.",
  donationsWillAppear: "Новые донаты появятся здесь.",
  all: "Все",
  notWatched: "Не просмотрено",
  watched: "Просмотрено",
  saved: "Сохранено",
  loadingVideoQueue: "Загрузка очереди видео",
  noVideos: "Нет видео",
  noVideosInQueue: "В очереди нет видео",
  noFilteredVideos: ({ status }: { status: string }) => `Нет видео со статусом «${status}»`,
  filteredVideosWillAppear: "Здесь появятся видео, соответствующие фильтру.",
  videoLinksWillAppear: "Здесь появятся ссылки на видео из донатов.",
  videoStatusFilters: "Фильтры статуса видео",
  queues: "Очереди",
  minimumDonation: "Минимальный донат за минуту видео.",
  loadingVideoPriorities: "Загрузка очередей видео",
  noQueuesYet: "Пока нет очередей.",
  selectQueueFilter: ({ label }: { label: string }) => `Выбрать фильтр очереди «${label}»`,
  editQueue: "Редактировать очередь",
  cancelEditing: "Отменить редактирование",
  name: "Название",
  minimumAmountPerMinute: "Минимальная сумма за минуту",
  enterQueueName: "Введите название очереди.",
  enterMinimumAmount: "Введите минимальную сумму.",
  enterAmountZeroOrMore: "Введите число не меньше нуля.",
  savingQueue: "Сохранение очереди",
  saveQueue: "Сохранить очередь",
  publicVideoQueueSlug: "Публичный идентификатор очереди видео",
  slugHelp: "После @ используйте от 3 до 47 строчных букв, цифр или дефисов.",
  slugInvalid: "После @ используйте от 3 до 47 строчных букв, цифр или дефисов.",
  saving: "Сохранение…",
  save: "Сохранить",
  copied: "Скопировано",
  copy: "Копировать",
  anonymous: "Аноним",
  sentDonation: "Отправлен донат",
  youtubeVideoFrom: ({ author }: { author: string }) => `Видео YouTube от ${author}`,
  minutes: ({ count }: { count: number }) => `${count} мин`,
  perMinute: "мин",
  unknownDuration: "Длительность неизвестна",
  editVideoDetails: "Редактировать видео",
  amount: "Сумма",
  durationMinutes: "Длительность, мин",
  enterPriorityAmount: "Введите сумму для приоритета.",
  donationAmountHelp: "Сумма доната определяет место видео в очереди.",
  enterDuration: "Введите длительность.",
  enterWholeMinutes: "Введите целое число минут.",
  durationHelp: "Длительность в минутах используется для расчёта места в очереди.",
  markVideoWatched: "Отметить видео просмотренным",
  markVideoNotWatched: "Отметить видео непросмотренным",
  saveVideo: "Сохранить видео",
  removeVideoSaved: "Убрать видео из сохранённых",
  watchedOn: ({ date }: { date: string }) => `Просмотрено ${date}`,
  savedOn: ({ date }: { date: string }) => `Сохранено ${date}`,
  videoQueueBy: ({ slug }: { slug: string }) => `Очередь видео: ${slug}`,
  videosSharedBySupporters: "Видео, которые зрители добавили через донаты.",
  queueNotFound: "Очередь не найдена",
  sharedQueueUnavailable: "Эта очередь видео недоступна.",
});

const messages = { en, ru } as const;

type TranslationArguments<Key extends TranslationKey> = (typeof en)[Key] extends (
  ...args: infer Args
) => string
  ? Args
  : [];

export type Translate = <Key extends TranslationKey>(
  key: Key,
  ...args: TranslationArguments<Key>
) => string;

export function createTranslator(locale: Locale): Translate {
  return ((key: TranslationKey, ...args: unknown[]) => {
    const message = messages[locale][key];
    return typeof message === "function"
      ? (message as (values: unknown) => string)(args[0])
      : message;
  }) as Translate;
}

type I18n = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (nextLocale: Locale) => {
      setLocaleState(nextLocale);
      document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
      router.update({
        context: {
          ...router.options.context,
          locale: nextLocale,
        },
      });
      void router.invalidate();
    },
    [router],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(locale),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
