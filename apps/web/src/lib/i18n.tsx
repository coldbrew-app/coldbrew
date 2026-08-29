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

type VideoTimeParts = {
  hours: number;
  minutes: number;
  seconds: number;
};

type HourMinuteParts = Pick<VideoTimeParts, "hours" | "minutes">;

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
  streamUpdate: "Your stream is brewing. Here is the signal right now.",
  brewStatus: "Live brew",
  orbitCaption: "Donations arrive. Reactions take off.",
  integrationsEyebrow: "Donation sources",
  alertsEyebrow: "Stream reactions",
  donationOrbit: "Supporter signal",
  queueOrbit: "The Milky Way queue",
  queueOrbitDescription: "Every video keeps its place on the route to your stream.",
  settingsDescription: "Tune the rules that keep your stream queue moving.",
  publicQueueEyebrow: "Live route to the stream",
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
  automaticSync: "Donations sync automatically.",
  connectAllDonations: "Connect DonationAlerts to see all your donations here.",
  manage: "Manage",
  readyForOverlay: "Need an overlay for your stream?",
  overlayDescription: "Show donations on stream with a browser source.",
  createOverlay: "Create overlay",
  welcomeBack: "Welcome back",
  signInDescription: "Sign in to manage your stream from one place.",
  signInEyebrow: "A long brew for bright moments",
  signInStory:
    "Collect every supporter signal, keep videos in orbit, and react when they reach the front.",
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
  secureConnection: "Coldbrew has secure access to your DonationAlerts account.",
  moreIntegrationsSoon: "More integrations are coming soon.",
  donationContent: "Donations section",
  videos: "Videos",
  chat: "Multichat",
  allDonations: "All donations",
  videoQueue: "Video queue",
  browseDonations: "Browse and search your supporters’ donations.",
  videosForStream: "Videos ready to play on stream.",
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
  pagination: "Pagination",
  previousPage: "Previous page",
  nextPage: "Next page",
  goToPage: ({ page }: { page: number }) => `Go to page ${page}`,
  pageOf: ({ page, totalPages }: { page: number; totalPages: number }) =>
    `Page ${page} of ${totalPages}`,
  showingResults: ({ first, last, total }: { first: number; last: number; total: number }) =>
    `Showing ${first}–${last} of ${total}`,
  all: "All",
  notWatched: "Not watched",
  watched: "Watched",
  bookmarked: "Bookmarked",
  loadingVideoQueue: "Loading video queue",
  noVideos: "No videos",
  noVideosInQueue: "No videos in the queue",
  noFilteredVideos: ({ status }: { status: string }) => `No ${status} videos`,
  filteredVideosWillAppear: "Videos matching this filter will appear here.",
  videoLinksWillAppear: "Videos from donations and videos you add will appear here.",
  videoStatusFilters: "Video status filters",
  queues: "Queues",
  minimumDonation: "Minimum donation per video minute.",
  loadingVideoPriorities: "Loading video priorities",
  noQueuesYet: "No queues yet.",
  selectQueueFilter: ({ label }: { label: string }) => `Select ${label} queue filter`,
  editQueue: "Edit queue",
  cancelEditing: "Cancel editing",
  cancel: "Cancel",
  name: "Name",
  minimumAmountPerMinute: "Minimum amount per minute",
  enterQueueName: "Enter a queue name.",
  enterMinimumAmount: "Enter a minimum amount.",
  enterAmountZeroOrMore: "Enter an amount of zero or more.",
  savingQueue: "Saving queue",
  saveQueue: "Save queue",
  publicVideoQueueSlug: "Public video queue handle",
  slugHelp: "Use 3–47 lowercase letters, numbers, or hyphens.",
  slugInvalid: "Use 3–47 lowercase letters, numbers, or hyphens.",
  publicQueueSettings: "Public video queue",
  publicQueueSettingsDescription: "Choose what viewers can see through your shared link.",
  publicQueueEnabled: "Link enabled",
  publicQueueDisabled: "Link disabled",
  publicQueueEnabledLabel: "Enable public link",
  publicQueueEnabledDescription: "Anyone with the link can open your video queue.",
  publicQueueShowAmounts: "Show amounts",
  publicQueueShowAmountsDescription: "Show the amount assigned to each video.",
  publicQueueShowWatched: "Show watched videos",
  publicQueueShowWatchedDescription: "Add a separate public history of watched videos.",
  openPublicQueue: "Open public queue",
  saving: "Saving…",
  save: "Save",
  copied: "Copied",
  copy: "Copy",
  anonymous: "Anonymous",
  sentDonation: "A donation was sent",
  video: "Video",
  youtubeVideoFrom: ({ author }: { author: string }) => `YouTube video from ${author}`,
  youtubeVideo: "YouTube video",
  addVideo: "Add video",
  addingVideo: "Adding video…",
  manualVideoUrl: "YouTube link",
  enterYoutubeUrl: "Enter a YouTube link.",
  invalidYoutubeUrl: "Enter a supported YouTube link.",
  videoCouldNotBeAdded:
    "Couldn't read this video or the timestamps are outside its duration. Check the values and try again.",
  fromDonation: "From donation",
  addedManually: "Added manually",
  openOnYoutube: "Open on YouTube",
  minutes: ({ count }: { count: number }) => `${count} min`,
  durationRemaining: ({ hours, minutes }: HourMinuteParts) =>
    `${hours > 0 ? `${hours} hr ` : ""}${minutes} min`,
  perMinute: "min",
  editVideoDetails: "Edit video details",
  amount: "Amount",
  videoStart: "Start",
  videoEnd: "End",
  videoEndPlaceholder: "Until the end",
  videoFromTime: ({ startTime }: { startTime: string }) => `From ${startTime}`,
  videoUntilTime: ({ endTime }: { endTime: string }) => `Until ${endTime}`,
  videoTimeRange: ({ startTime, endTime }: { startTime: string; endTime: string }) =>
    `From ${startTime} until ${endTime}`,
  parsedVideoTime: ({ hours, minutes, seconds }: VideoTimeParts) =>
    `${hours > 0 ? `${hours} hr ` : ""}${minutes} min ${seconds} sec`,
  watchDuration: ({ hours, minutes, seconds }: VideoTimeParts) =>
    `Watch time: ${hours > 0 ? `${hours} hr ` : ""}${minutes} min ${seconds} sec`,
  enterPriorityAmount: "Enter a priority amount.",
  queueAmountHelp: "The amount and watch time determine the video’s queue position.",
  enterVideoTime: "Enter a timestamp.",
  invalidVideoTime: "Use MM:SS or HH:MM:SS.",
  videoEndAfterStart: "The end must be after the start.",
  videoTimingHelp: "Start and end determine the watch time and queue position.",
  manualVideoTimingHelp: "Leave the end empty to watch the video until it finishes.",
  markVideoWatched: "Mark video as watched",
  markVideoNotWatched: "Mark video as not watched",
  bookmarkVideo: "Bookmark video",
  removeVideoBookmark: "Remove video bookmark",
  watchedOn: ({ date }: { date: string }) => `Watched ${date}`,
  bookmarkedOn: ({ date }: { date: string }) => `Bookmarked ${date}`,
  videoQueueBy: ({ slug }: { slug: string }) => `Video queue: ${slug}`,
  videosSharedBySupporters: "Videos selected for the stream.",
  publicQueueTabs: "Public video queue sections",
  currentQueue: "Queue",
  noWatchedVideos: "No watched videos",
  watchedVideosWillAppear: "Videos will appear here after the streamer watches them.",
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
  overview: "Главная",
  donations: "Донаты",
  integrations: "Интеграции",
  alerts: "Оповещения",
  settings: "Настройки",
  queueCurrency: "Валюта очереди",
  queueCurrencyDescription: "В этой валюте указаны суммы видео и пороги очередей.",
  changeQueueCurrency: "Изменить валюту",
  queueCurrencyRate: ({ larger, smaller }: { larger: string; smaller: string }) =>
    `Количество ${smaller} за 1 ${larger}`,
  queueCurrencyWarning:
    "Суммы видео и пороги очередей пересчитаются по указанному курсу. Сами видео останутся в прежних очередях.",
  enterExchangeRate: "Укажите курс больше нуля.",
  underConstruction: "В разработке",
  signOut: "Выйти",
  logOut: "Выйти",
  switchToLightMode: "Включить светлую тему",
  switchToDarkMode: "Включить тёмную тему",
  language: "Язык",
  openNavigation: "Открыть меню",
  english: "Английский",
  russian: "Русский",
  activeDevelopment:
    "Coldbrew активно развивается. Некоторые функции могут измениться, а данные — потеряться.",
  dismissDevelopmentWarning: "Скрыть предупреждение",
  greeting: ({ name }: { name: string }) => `Рады вас видеть, ${name}`,
  streamUpdate: "Всё важное о вашем стриме — на одном экране.",
  brewStatus: "Сводка по стриму",
  orbitCaption: "Получайте донаты. Создавайте яркие моменты.",
  integrationsEyebrow: "Источники донатов",
  alertsEyebrow: "Реакции на стриме",
  donationOrbit: "Все донаты",
  queueOrbit: "Управление очередью",
  queueOrbitDescription: "Управляйте видео из донатов и добавляйте свои.",
  settingsDescription: "Настройте публичный доступ и валюту очереди.",
  publicQueueEyebrow: "Публичная очередь",
  streamStatistics: "Статистика стрима",
  totalReceived: "Всего получено",
  averageDonation: "Средний донат",
  versusPreviousPeriod: "к предыдущему периоду",
  acrossPlatforms: "По всем подключённым платформам",
  recentActivity: "Последние донаты",
  everyDonation: "Свежие донаты со всех подключённых платформ.",
  viewAll: "Посмотреть все",
  donationTrends: "Динамика донатов",
  earningsOverTime: "Изменение суммы донатов за выбранный период.",
  revenue: "Доход",
  automaticSync: "Новые донаты загружаются автоматически.",
  connectAllDonations: "Подключите DonationAlerts, чтобы видеть все донаты здесь.",
  manage: "Настроить",
  readyForOverlay: "Нужен оверлей для стрима?",
  overlayDescription: "Выведите донаты на стрим через браузерный источник.",
  createOverlay: "Создать оверлей",
  welcomeBack: "С возвращением",
  signInDescription: "Войдите, чтобы управлять донатами и видео в одном месте.",
  signInEyebrow: "Всё для вашего стрима",
  signInStory:
    "Собирайте донаты с разных платформ, управляйте очередью видео и не упускайте важное во время стрима.",
  redirecting: "Входим…",
  continueWithGoogle: "Войти через Google",
  integrationsDescription: "Подключите сервисы, чтобы собирать все донаты в одном месте.",
  connected: "Подключено",
  notConnected: "Не подключено",
  donationsSyncing: "Новые донаты из DonationAlerts загружаются автоматически.",
  importDonations: "Подключите DonationAlerts, чтобы донаты загружались автоматически.",
  disconnecting: "Отключаем…",
  disconnect: "Отключить",
  connectDonationAlerts: "Подключить DonationAlerts",
  secureAuthorization: "Войдите в DonationAlerts и разрешите Coldbrew получать ваши донаты.",
  secureConnection: "Coldbrew получает донаты из вашего аккаунта DonationAlerts.",
  moreIntegrationsSoon: "Скоро добавим другие сервисы.",
  donationContent: "Донаты",
  videos: "Видео",
  chat: "Мультичат",
  allDonations: "Все донаты",
  videoQueue: "Очередь видео",
  browseDonations: "Просматривайте донаты и находите нужные по имени или сообщению.",
  videosForStream: "Видео, которые можно показать на стриме.",
  searchDonations: "Поиск донатов",
  searchBySupporter: "Имя отправителя или текст сообщения…",
  dateRange: "Период",
  allTime: "За всё время",
  last7Days: "Последние 7 дней",
  last30Days: "Последние 30 дней",
  loadingDonations: "Загружаем донаты…",
  dataLoadError: "Не удалось загрузить данные",
  dataLoadErrorDescription: "Проверьте подключение и попробуйте ещё раз.",
  tryAgain: "Повторить",
  retrying: "Загружаем снова…",
  loadingAuthorization: "Получаем ссылку…",
  authorizationUnavailable: "Не удалось получить ссылку",
  noMatchingDonations: "По вашему запросу ничего не найдено",
  noDonationsYet: "Донатов пока нет",
  tryAnotherSearch: "Измените запрос или сбросьте фильтры.",
  donationsWillAppear: "Новые донаты появятся здесь.",
  pagination: "Навигация по страницам",
  previousPage: "Предыдущая страница",
  nextPage: "Следующая страница",
  goToPage: ({ page }: { page: number }) => `Перейти на страницу ${page}`,
  pageOf: ({ page, totalPages }: { page: number; totalPages: number }) =>
    `Страница ${page} из ${totalPages}`,
  showingResults: ({ first, last, total }: { first: number; last: number; total: number }) =>
    `${first}–${last} из ${total}`,
  all: "Все",
  notWatched: "Не просмотрено",
  watched: "Просмотрено",
  bookmarked: "В закладках",
  loadingVideoQueue: "Загружаем очередь видео…",
  noVideos: "Нет видео",
  noVideosInQueue: "В очереди нет видео",
  noFilteredVideos: ({ status: _status }: { status: string }) =>
    "По этому фильтру ничего не найдено",
  filteredVideosWillAppear: "Попробуйте выбрать другой фильтр.",
  videoLinksWillAppear: "Здесь появятся видео из донатов и добавленные вручную.",
  videoStatusFilters: "Фильтр видео по статусу",
  queues: "Очереди",
  minimumDonation: "Минимальная сумма за минуту просмотра.",
  loadingVideoPriorities: "Загружаем очереди…",
  noQueuesYet: "Очереди пока не настроены.",
  selectQueueFilter: ({ label }: { label: string }) => `Показать очередь «${label}»`,
  editQueue: "Изменить очередь",
  cancelEditing: "Отменить",
  cancel: "Отменить",
  name: "Название",
  minimumAmountPerMinute: "Минимальная сумма за минуту просмотра",
  enterQueueName: "Укажите название очереди.",
  enterMinimumAmount: "Укажите минимальную сумму.",
  enterAmountZeroOrMore: "Укажите число не меньше нуля.",
  savingQueue: "Сохраняем очередь…",
  saveQueue: "Сохранить очередь",
  publicVideoQueueSlug: "Адрес публичной очереди видео",
  slugHelp: "Используйте от 3 до 47 строчных латинских букв, цифр или дефисов.",
  slugInvalid: "Введите от 3 до 47 строчных латинских букв, цифр или дефисов.",
  publicQueueSettings: "Доступ к очереди по ссылке",
  publicQueueSettingsDescription: "Настройте, что зрители увидят в публичной очереди.",
  publicQueueEnabled: "Доступ по ссылке включён",
  publicQueueDisabled: "Доступ по ссылке выключен",
  publicQueueEnabledLabel: "Открыть доступ по ссылке",
  publicQueueEnabledDescription: "Все, у кого есть ссылка, смогут посмотреть очередь видео.",
  publicQueueShowAmounts: "Показывать суммы",
  publicQueueShowAmountsDescription: "Показывать сумму для очереди у каждого видео.",
  publicQueueShowWatched: "Показывать просмотренные видео",
  publicQueueShowWatchedDescription: "Добавить отдельный раздел с просмотренными видео.",
  openPublicQueue: "Посмотреть публичную очередь",
  saving: "Сохраняем…",
  save: "Сохранить",
  copied: "Скопировано",
  copy: "Скопировать",
  anonymous: "Аноним",
  sentDonation: "Без сообщения",
  video: "Видео",
  youtubeVideoFrom: ({ author }: { author: string }) => `Видео YouTube от ${author}`,
  youtubeVideo: "Видео YouTube",
  addVideo: "Добавить видео",
  addingVideo: "Добавляем видео…",
  manualVideoUrl: "Ссылка на YouTube",
  enterYoutubeUrl: "Введите ссылку на YouTube.",
  invalidYoutubeUrl: "Ссылка не ведёт на поддерживаемое видео YouTube.",
  videoCouldNotBeAdded: "Не удалось загрузить данные видео. Проверьте ссылку и таймкоды.",
  fromDonation: "Из доната",
  addedManually: "Добавлено вручную",
  openOnYoutube: "Открыть на YouTube",
  minutes: ({ count }: { count: number }) => `${count} мин`,
  durationRemaining: ({ hours, minutes }: HourMinuteParts) =>
    `${hours > 0 ? `${hours} ч ` : ""}${minutes} мин`,
  perMinute: "мин",
  editVideoDetails: "Изменить видео",
  amount: "Сумма для очереди",
  videoStart: "Начало",
  videoEnd: "Конец",
  videoEndPlaceholder: "До конца",
  videoFromTime: ({ startTime }: { startTime: string }) => `С ${startTime}`,
  videoUntilTime: ({ endTime }: { endTime: string }) => `До ${endTime}`,
  videoTimeRange: ({ startTime, endTime }: { startTime: string; endTime: string }) =>
    `С ${startTime} до ${endTime}`,
  parsedVideoTime: ({ hours, minutes, seconds }: VideoTimeParts) =>
    `${hours > 0 ? `${hours} ч ` : ""}${minutes} мин ${seconds} с`,
  watchDuration: ({ hours, minutes, seconds }: VideoTimeParts) =>
    `Время просмотра: ${hours > 0 ? `${hours} ч ` : ""}${minutes} мин ${seconds} с`,
  enterPriorityAmount: "Укажите сумму для очереди.",
  queueAmountHelp: "Сумма и длительность определяют, в какую очередь попадёт видео.",
  enterVideoTime: "Укажите время.",
  invalidVideoTime: "Используйте формат ММ:СС или ЧЧ:ММ:СС.",
  videoEndAfterStart: "Конец должен быть позже начала.",
  videoTimingHelp: "Выбранный отрезок влияет на длительность просмотра и очередь.",
  manualVideoTimingHelp: "Оставьте поле «Конец» пустым, чтобы воспроизвести видео до конца.",
  markVideoWatched: "Отметить видео просмотренным",
  markVideoNotWatched: "Снять отметку о просмотре",
  bookmarkVideo: "Добавить видео в закладки",
  removeVideoBookmark: "Убрать видео из закладок",
  watchedOn: ({ date }: { date: string }) => `Просмотрено: ${date}`,
  bookmarkedOn: ({ date }: { date: string }) => `В закладках: ${date}`,
  videoQueueBy: ({ slug }: { slug: string }) => `Очередь видео — ${slug}`,
  videosSharedBySupporters: "Видео, которые стример планирует посмотреть.",
  publicQueueTabs: "Разделы публичной очереди",
  currentQueue: "Сейчас в очереди",
  noWatchedVideos: "Просмотренных видео пока нет",
  watchedVideosWillAppear: "После просмотра видео появятся здесь.",
  queueNotFound: "Очередь недоступна",
  sharedQueueUnavailable: "Возможно, ссылка неверна или владелец закрыл доступ.",
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
