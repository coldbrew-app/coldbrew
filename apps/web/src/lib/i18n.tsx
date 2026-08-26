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
  streamUpdate: "Your stream is brewing. Here is the signal right now.",
  brewStatus: "Live brew",
  orbitCaption: "Donations arrive. Reactions take off.",
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
  slugHelp: "After @, use 3–47 lowercase letters, numbers, or hyphens.",
  slugInvalid: "After @, use 3–47 lowercase letters, numbers, or hyphens.",
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
  minutesRemaining: ({ count }: { count: number }) => `${count} min left`,
  perMinute: "min",
  editVideoDetails: "Edit video details",
  amount: "Amount",
  videoStart: "Start",
  videoEnd: "End",
  videoEndPlaceholder: "Until the end",
  watchDuration: ({ duration }: { duration: string }) => `Watch time: ${duration}`,
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
  streamUpdate: "Стрим заваривается. Вот его сигнал прямо сейчас.",
  brewStatus: "Стрим в эфире",
  orbitCaption: "Донаты прилетают. Реакции взлетают.",
  donationOrbit: "Сигнал от зрителей",
  queueOrbit: "Очередь Млечного Пути",
  queueOrbitDescription: "Каждое видео сохраняет своё место на пути к стриму.",
  settingsDescription: "Настройте правила, по которым движется очередь стрима.",
  publicQueueEyebrow: "Маршрут к стриму в эфире",
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
  automaticSync: "Донаты синхронизируются автоматически.",
  connectAllDonations: "Подключите DonationAlerts, чтобы видеть все донаты здесь.",
  manage: "Управлять",
  readyForOverlay: "Нужен оверлей для стрима?",
  overlayDescription: "Выведите донаты на стрим через браузерный источник.",
  createOverlay: "Создать оверлей",
  welcomeBack: "С возвращением",
  signInDescription: "Войдите, чтобы управлять стримом из одного места.",
  signInEyebrow: "Долгая заварка для ярких моментов",
  signInStory:
    "Собирайте сигналы зрителей, держите видео на орбите и реагируйте, когда они доберутся до начала очереди.",
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
  secureConnection: "Coldbrew имеет безопасный доступ к вашему аккаунту DonationAlerts.",
  moreIntegrationsSoon: "Скоро появятся другие интеграции.",
  donationContent: "Раздел донатов",
  videos: "Видео",
  allDonations: "Все донаты",
  videoQueue: "Очередь видео",
  browseDonations: "Просматривайте и ищите донаты зрителей.",
  videosForStream: "Видео, готовые к показу на стриме.",
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
  pagination: "Пагинация",
  previousPage: "Предыдущая страница",
  nextPage: "Следующая страница",
  goToPage: ({ page }: { page: number }) => `Перейти на страницу ${page}`,
  pageOf: ({ page, totalPages }: { page: number; totalPages: number }) =>
    `Страница ${page} из ${totalPages}`,
  showingResults: ({ first, last, total }: { first: number; last: number; total: number }) =>
    `Показаны ${first}–${last} из ${total}`,
  all: "Все",
  notWatched: "Не просмотрено",
  watched: "Просмотрено",
  bookmarked: "В закладках",
  loadingVideoQueue: "Загрузка очереди видео",
  noVideos: "Нет видео",
  noVideosInQueue: "В очереди нет видео",
  noFilteredVideos: ({ status }: { status: string }) => `Нет видео со статусом «${status}»`,
  filteredVideosWillAppear: "Здесь появятся видео, соответствующие фильтру.",
  videoLinksWillAppear: "Здесь появятся видео из донатов и добавленные вами.",
  videoStatusFilters: "Фильтры статуса видео",
  queues: "Очереди",
  minimumDonation: "Минимальный донат за минуту видео.",
  loadingVideoPriorities: "Загрузка очередей видео",
  noQueuesYet: "Пока нет очередей.",
  selectQueueFilter: ({ label }: { label: string }) => `Выбрать фильтр очереди «${label}»`,
  editQueue: "Редактировать очередь",
  cancelEditing: "Отменить редактирование",
  cancel: "Отмена",
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
  publicQueueSettings: "Публичная очередь видео",
  publicQueueSettingsDescription: "Выберите, что увидят зрители по общей ссылке.",
  publicQueueEnabled: "Ссылка включена",
  publicQueueDisabled: "Ссылка выключена",
  publicQueueEnabledLabel: "Включить публичную ссылку",
  publicQueueEnabledDescription: "Любой человек со ссылкой сможет открыть очередь видео.",
  publicQueueShowAmounts: "Показывать суммы",
  publicQueueShowAmountsDescription: "Показывать сумму, назначенную каждому видео.",
  publicQueueShowWatched: "Показывать просмотренные видео",
  publicQueueShowWatchedDescription: "Добавить отдельную публичную историю просмотров.",
  openPublicQueue: "Открыть публичную очередь",
  saving: "Сохранение…",
  save: "Сохранить",
  copied: "Скопировано",
  copy: "Копировать",
  anonymous: "Аноним",
  sentDonation: "Отправлен донат",
  video: "Видео",
  youtubeVideoFrom: ({ author }: { author: string }) => `Видео YouTube от ${author}`,
  youtubeVideo: "Видео YouTube",
  addVideo: "Добавить видео",
  addingVideo: "Добавление видео…",
  manualVideoUrl: "Ссылка на YouTube",
  enterYoutubeUrl: "Введите ссылку на YouTube.",
  invalidYoutubeUrl: "Введите поддерживаемую ссылку на YouTube.",
  videoCouldNotBeAdded:
    "Не удалось прочитать видео или таймкоды выходят за его длительность. Проверьте значения и попробуйте снова.",
  fromDonation: "Из доната",
  addedManually: "Добавлено вручную",
  openOnYoutube: "Открыть на YouTube",
  minutes: ({ count }: { count: number }) => `${count} мин`,
  minutesRemaining: ({ count }: { count: number }) => `${count} мин осталось`,
  perMinute: "мин",
  editVideoDetails: "Редактировать видео",
  amount: "Сумма",
  videoStart: "Начало",
  videoEnd: "Окончание",
  videoEndPlaceholder: "До конца",
  watchDuration: ({ duration }: { duration: string }) => `Время просмотра: ${duration}`,
  enterPriorityAmount: "Введите сумму для приоритета.",
  queueAmountHelp: "Сумма и время просмотра определяют место видео в очереди.",
  enterVideoTime: "Введите таймкод.",
  invalidVideoTime: "Используйте формат ММ:СС или ЧЧ:ММ:СС.",
  videoEndAfterStart: "Окончание должно быть позже начала.",
  videoTimingHelp: "Начало и окончание определяют время просмотра и место в очереди.",
  manualVideoTimingHelp: "Оставьте окончание пустым, чтобы смотреть видео до конца.",
  markVideoWatched: "Отметить видео просмотренным",
  markVideoNotWatched: "Отметить видео непросмотренным",
  bookmarkVideo: "Добавить видео в закладки",
  removeVideoBookmark: "Убрать видео из закладок",
  watchedOn: ({ date }: { date: string }) => `Просмотрено ${date}`,
  bookmarkedOn: ({ date }: { date: string }) => `Добавлено в закладки ${date}`,
  videoQueueBy: ({ slug }: { slug: string }) => `Очередь видео: ${slug}`,
  videosSharedBySupporters: "Видео, выбранные для стрима.",
  publicQueueTabs: "Разделы публичной очереди видео",
  currentQueue: "Очередь",
  noWatchedVideos: "Нет просмотренных видео",
  watchedVideosWillAppear: "Видео появятся здесь после того, как стример их посмотрит.",
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
