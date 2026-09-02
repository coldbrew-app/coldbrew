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
  landingPageTitle: "Donations, video queue, and multichat for streamers",
  signIn: "Sign in",
  welcomeBack: "Welcome back",
  signInDescription: "Sign in to manage your stream from one place.",
  signInEyebrow: "A long brew for bright moments",
  signInStory:
    "Collect every supporter signal, keep videos in orbit, and react when they reach the front.",
  landingHeadline: "One calm control room for a busy stream.",
  landingDescription:
    "Coldbrew helps streamers collect donations, organise viewer-submitted videos, follow live chats, and share what is coming next — all in one place.",
  landingSignInNote: "Google sign-in creates and protects your Coldbrew account.",
  landingSignalEyebrow: "From supporter to stream",
  landingWorkflowEyebrow: "One connected flow",
  landingWorkflow: "Donation → video queue → on-stream reaction",
  landingFeaturesEyebrow: "Built for live moments",
  landingFeaturesTitle: "Keep every supporter signal within reach.",
  landingFeaturesDescription:
    "Connect the services you use, then manage the activity around your stream without switching between dashboards.",
  landingDonationsTitle: "Donations in one feed",
  landingDonationsDescription:
    "Connect supported donation sources and browse supporter names, amounts, messages, and recent activity together.",
  landingVideoQueueTitle: "A video queue you control",
  landingVideoQueueDescription:
    "Turn supported links from donation messages into videos, add videos manually, and organise them by your own priorities.",
  landingMultichatTitle: "Live chats side by side",
  landingMultichatDescription:
    "Bring supported streaming chats into one feed so messages stay visible while you focus on the broadcast.",
  landingSharingTitle: "Public views and overlays",
  landingSharingDescription:
    "Share a public video queue with viewers and use browser-source overlays to bring selected activity onto the stream.",
  googleDataEyebrow: "Transparent Google sign-in",
  googleDataTitle: "Your account data has one job.",
  googleDataDescription:
    "When you continue with Google, Google shares your name, email address, and profile image with Coldbrew. We use them to create your account, identify you when you return, and show your account details.",
  googleDataNoExtraAccess:
    "Google sign-in does not give Coldbrew access to Gmail, Google Drive, or Google Calendar. If you separately connect YouTube chat, Coldbrew requests YouTube permissions for chat messages and moderation.",
  readPrivacyPolicy: "Read the Privacy policy",
  landingFooter: "Coldbrew — tools for streamers.",
  legalLinks: "Legal information",
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
  watchDuration: ({ hours, minutes }: HourMinuteParts) =>
    `Watch time: ${hours > 0 ? `${hours} hr ` : ""}${minutes} min`,
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
  privacyPolicy: "Privacy policy",
  termsOfService: "Terms of service",
  legalEffectiveDate: "Effective as of September 2, 2026.",
  privacyDataTitle: "Data we process",
  privacyDataDescription:
    "We process account data: name, email address, and profile image. When you connect YouTube chat, Coldbrew receives OAuth access and refresh tokens, your channel identity, active-broadcast information, live chat messages, and identifiers needed for moderation. Connected donation sources provide the account, donation, and token data needed to operate those integrations.",
  privacyPurposeTitle: "Why we use it",
  privacyPurposeDescription:
    "This data lets us create and protect your account, receive donations, build the video queue, and maintain the service. YouTube data is used only to show the connected live chat, send messages you request, perform moderation actions you initiate, and display chat in an overlay you enable.",
  privacySharingTitle: "Sharing and access",
  privacySharingDescription:
    "We do not sell personal or Google user data, use it for advertising, or share it except as needed to operate an integration you connected. If you enable a public queue or chat overlay, the information selected for that feature is available to visitors through its public link.",
  privacyRetentionTitle: "Retention and your rights",
  privacyRetentionDescription:
    "YouTube OAuth tokens are encrypted at rest and retained only while the connection is active. Live chat message text is processed transiently and is not stored in the Coldbrew database. Disconnecting YouTube removes its stored tokens and connection data from Coldbrew; you can also revoke access in your Google Account. When you delete your Coldbrew account, its related data is deleted subject to applicable law.",
  privacyAgreement:
    "By using Coldbrew, you agree to this policy. For questions about data processing, contact the service owner through an available support channel.",
  termsServiceTitle: "The service",
  termsServiceDescription:
    "Coldbrew helps streamers collect donation data from connected sources, build a video queue, and show it on stream. The service is provided as is and may be changed or extended.",
  termsAccountTitle: "Account and integrations",
  termsAccountDescription:
    "You are responsible for keeping your account secure, for the legality of connected accounts, and for having the right to use them. By connecting a third-party platform, you also accept its terms. You can disconnect an integration in settings.",
  termsAcceptableUseTitle: "Acceptable use",
  termsAcceptableUseDescription:
    "You may not use Coldbrew to break the law, infringe third-party rights or connected-platform rules, or attempt to disrupt the service or its security. You are responsible for the content of donations, messages, videos, and public pages created through the service.",
  termsLiabilityTitle: "Limitation of liability",
  termsLiabilityDescription:
    "We aim to keep the service available and accurate, but do not guarantee uninterrupted operation, the preservation of third-party-platform data, or the absence of errors. To the extent permitted by law, Coldbrew is not liable for indirect losses arising from use of the service.",
  termsAgreement: "By continuing to use Coldbrew, you accept these terms and the Privacy policy.",
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
  landingPageTitle: "Донаты, очередь видео и мультичат для стримеров",
  signIn: "Войти",
  welcomeBack: "С возвращением",
  signInDescription: "Войдите, чтобы управлять донатами и видео в одном месте.",
  signInEyebrow: "Всё для вашего стрима",
  signInStory:
    "Собирайте донаты с разных платформ, управляйте очередью видео и не упускайте важное во время стрима.",
  landingHeadline: "Всё для активного стрима — на одном спокойном экране.",
  landingDescription:
    "Coldbrew помогает стримерам собирать донаты, управлять видео от зрителей, следить за чатами и показывать, что будет дальше, — в одном месте.",
  landingSignInNote: "Вход через Google создаёт и защищает ваш аккаунт Coldbrew.",
  landingSignalEyebrow: "От зрителя до стрима",
  landingWorkflowEyebrow: "Единый процесс",
  landingWorkflow: "Донат → очередь видео → реакция на стриме",
  landingFeaturesEyebrow: "Для живых моментов",
  landingFeaturesTitle: "Каждый сигнал от зрителей остаётся под рукой.",
  landingFeaturesDescription:
    "Подключите нужные сервисы и управляйте событиями вокруг стрима, не переключаясь между разными панелями.",
  landingDonationsTitle: "Донаты в одной ленте",
  landingDonationsDescription:
    "Подключайте поддерживаемые источники донатов и просматривайте имена отправителей, суммы, сообщения и последние события вместе.",
  landingVideoQueueTitle: "Управляемая очередь видео",
  landingVideoQueueDescription:
    "Превращайте поддерживаемые ссылки из сообщений к донатам в видео, добавляйте видео вручную и распределяйте их по своим очередям.",
  landingMultichatTitle: "Чаты в одной ленте",
  landingMultichatDescription:
    "Объединяйте чаты поддерживаемых стриминговых платформ, чтобы видеть сообщения и не отвлекаться от трансляции.",
  landingSharingTitle: "Публичные страницы и оверлеи",
  landingSharingDescription:
    "Делитесь со зрителями публичной очередью видео и выводите выбранные события на стрим через браузерные оверлеи.",
  googleDataEyebrow: "Прозрачный вход через Google",
  googleDataTitle: "Данные аккаунта используются только по назначению.",
  googleDataDescription:
    "При входе Google передаёт Coldbrew ваше имя, адрес электронной почты и изображение профиля. Они нужны, чтобы создать аккаунт, узнавать вас при повторном входе и показывать данные аккаунта.",
  googleDataNoExtraAccess:
    "Вход через Google не даёт Coldbrew доступ к Gmail, Google Диску или Google Календарю. Если вы отдельно подключите чат YouTube, Coldbrew запросит разрешения YouTube для работы с сообщениями и модерацией.",
  readPrivacyPolicy: "Открыть Политику конфиденциальности",
  landingFooter: "Coldbrew — инструменты для стримеров.",
  legalLinks: "Юридическая информация",
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
  watchDuration: ({ hours, minutes }: HourMinuteParts) =>
    `Время просмотра: ${hours > 0 ? `${hours} ч ` : ""}${minutes} мин`,
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
  privacyPolicy: "Политика конфиденциальности",
  termsOfService: "Условия использования",
  legalEffectiveDate: "Действует с 2 сентября 2026 года.",
  privacyDataTitle: "Какие данные мы обрабатываем",
  privacyDataDescription:
    "Мы обрабатываем данные учётной записи: имя, адрес электронной почты и изображение профиля. При подключении чата YouTube Coldbrew получает токены доступа и обновления OAuth, сведения о вашем канале и активной трансляции, сообщения чата и идентификаторы для модерации. Подключённые источники донатов передают данные аккаунта, донатов и токенов, необходимые для работы этих интеграций.",
  privacyPurposeTitle: "Зачем это нужно",
  privacyPurposeDescription:
    "Эти данные нужны, чтобы создать и защитить учётную запись, получать донаты, формировать очередь видео и поддерживать работу сервиса. Данные YouTube используются только для показа подключённого чата, отправки запрошенных вами сообщений, выполнения инициированных вами действий модерации и вывода чата в включённый вами оверлей.",
  privacySharingTitle: "Передача и доступ",
  privacySharingDescription:
    "Мы не продаём персональные данные или данные пользователей Google, не используем их для рекламы и не передаём иначе, чем для работы подключённой вами интеграции. Если вы включили публичную очередь или чат-оверлей, выбранные для этой функции сведения доступны посетителям по публичной ссылке.",
  privacyRetentionTitle: "Хранение и ваши права",
  privacyRetentionDescription:
    "Токены OAuth YouTube хранятся в зашифрованном виде только пока подключение активно. Текст сообщений чата обрабатывается временно и не сохраняется в базе данных Coldbrew. Отключение YouTube удаляет его токены и данные подключения из Coldbrew; доступ также можно отозвать в аккаунте Google. При удалении аккаунта Coldbrew связанные с ним данные удаляются с учётом требований закона.",
  privacyAgreement:
    "Используя Coldbrew, вы соглашаетесь с этой политикой. По вопросам обработки данных свяжитесь с владельцем сервиса через доступный канал поддержки.",
  termsServiceTitle: "Сервис",
  termsServiceDescription:
    "Coldbrew помогает стримерам собирать данные о донатах из подключённых источников, формировать очередь видео и выводить их на стрим. Сервис предоставляется «как есть» и может изменяться или дополняться.",
  termsAccountTitle: "Учётная запись и интеграции",
  termsAccountDescription:
    "Вы отвечаете за безопасность своей учётной записи, законность подключаемых аккаунтов и наличие прав на их использование. Подключая стороннюю платформу, вы также принимаете её правила и условия. Вы можете отключить интеграцию в настройках.",
  termsAcceptableUseTitle: "Допустимое использование",
  termsAcceptableUseDescription:
    "Нельзя использовать Coldbrew для нарушения закона, прав третьих лиц, правил подключённых платформ, а также для попыток нарушить работу или безопасность сервиса. Вы несёте ответственность за контент донатов, сообщений, видео и публичных страниц, созданных с помощью сервиса.",
  termsLiabilityTitle: "Ограничение ответственности",
  termsLiabilityDescription:
    "Мы стремимся поддерживать доступность и корректность сервиса, но не гарантируем его бесперебойную работу, сохранность данных сторонних платформ или отсутствие ошибок. Насколько это допускает закон, Coldbrew не отвечает за косвенные убытки, возникшие при использовании сервиса.",
  termsAgreement:
    "Продолжая пользоваться Coldbrew, вы принимаете эти условия и Политику конфиденциальности.",
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
  return (key: TranslationKey, ...args: unknown[]) => {
    const message = messages[locale][key];
    if (typeof message !== "function") {
      return message;
    }
    const translated: unknown = Reflect.apply(message, undefined, args);
    if (typeof translated !== "string") {
      throw new TypeError(`Translation ${key} did not return a string.`);
    }
    return translated;
  };
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
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
