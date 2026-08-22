import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { Icons } from "@web/components/icons";
import SignIn from "@web/components/sign-in";
import { Button } from "@web/components/ui/button";
import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar } from "@web/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@web/components/ui/tooltip";
import { useUserInfo } from "@web/hooks/api";
import { parseCookie } from "cookie-es";
import { Suspense, useEffect, useRef, useState } from "react";

import logo from "../../assets/logo.svg";
import { Skeleton } from "../components/ui/skeleton";
import { signOut } from "../lib/auth-client";
import type { Locale } from "../lib/i18n";
import { I18nProvider, useI18n } from "../lib/i18n";
import { localeCookieName, resolveLocale } from "../lib/locale";
import type { Theme } from "../lib/theme";
import { resolveTheme, themeCookieName } from "../lib/theme";
import type { Api } from "../lib/trpc";
import type { Viewer } from "../server/api/_util";
import { getRequestLocale } from "../server/locale";
import { getRequestTheme } from "../server/theme";
import { currentViewerQueryOptions } from "../server/viewer";
import PageLoadingSkeleton from "./-components/page-loading-skeleton";

import appCss from "../../styles.css?url";

const navItem =
  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const activeNavItem = "bg-sidebar-accent font-bold text-sidebar-accent-foreground";
const localeFlags: Record<Locale, string> = { en: "🇬🇧", ru: "🇷🇺" };
const themeCookieMaxAge = 60 * 60 * 24 * 365;

const getRouteLocale = createIsomorphicFn()
  .client(() => resolveLocale(parseCookie(document.cookie)[localeCookieName], navigator.language))
  .server(() => getRequestLocale());

const getRouteTheme = createIsomorphicFn()
  .client(() => resolveTheme(parseCookie(document.cookie)[themeCookieName]))
  .server(() => getRequestTheme());

export const Route = createRootRouteWithContext<
  Api & {
    locale: Locale;
    theme: Theme;
    viewer: Viewer | null;
  }
>()({
  beforeLoad: async ({ context }) => {
    const [locale, theme, viewer] = await Promise.all([
      getRouteLocale(),
      getRouteTheme(),
      context.queryClient.ensureQueryData({
        ...currentViewerQueryOptions(),
        revalidateIfStale: true,
      }),
    ]);
    return { locale, theme, viewer };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Coldbrew" },
    ],
    links: [
      { href: appCss, rel: "stylesheet" },
      { href: logo, rel: "icon", type: "image/svg+xml" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  const { locale, theme } = Route.useRouteContext();

  return (
    <html className={theme === "dark" ? "dark" : undefined} lang={locale} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider initialLocale={locale}>
          <TooltipProvider>
            <Outlet />
          </TooltipProvider>
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

function useDark(initialTheme: Theme) {
  const [isDark, setIsDark] = useState(initialTheme === "dark");
  const toggleDark = () => {
    const theme = isDark ? "light" : "dark";
    setIsDark(theme === "dark");
    document.cookie = `${themeCookieName}=${theme}; Path=/; Max-Age=${themeCookieMaxAge}; SameSite=Lax`;
  };
  return { isDark, toggleDark };
}

export function AuthenticatedRoot() {
  const { viewer } = Route.useRouteContext();

  if (!viewer) return <SignIn />;

  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <AuthenticatedApplication />
    </Suspense>
  );
}

function AuthenticatedApplication() {
  return (
    <SidebarProvider>
      <AuthenticatedApplicationContent />
    </SidebarProvider>
  );
}

function AuthenticatedApplicationContent() {
  const { theme, viewer } = Route.useRouteContext();
  const { isDark, toggleDark } = useDark(theme);
  const { locale, setLocale, t } = useI18n();
  const { setOpenMobile } = useSidebar();
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isDevelopmentWarningVisible, setIsDevelopmentWarningVisible] = useState(true);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const userInfo = useUserInfo();

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  useEffect(() => {
    const closeLanguageMenu = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) setIsLanguageMenuOpen(false);
    };

    document.addEventListener("mousedown", closeLanguageMenu);
    return () => document.removeEventListener("mousedown", closeLanguageMenu);
  }, []);

  if (!viewer || !userInfo) {
    return <SignIn />;
  }

  const user = viewer.user;

  return (
    <main className="flex h-dvh w-full min-w-0 bg-background font-sans text-foreground transition-colors duration-300">
      <Sidebar>
        <aside className="flex size-full flex-col border-r border-sidebar-border bg-sidebar px-4 pt-8 pb-5 transition-colors duration-300">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2.5 px-1 font-heading text-[1.45rem] font-semibold tracking-tight text-sidebar-foreground"
            >
              <img alt="" src={logo} className="h-[24px]" />
              coldbrew
            </Link>
          </div>
          <nav className="mt-11 grid gap-1.5" aria-label={t("overview")}>
            <Link
              activeOptions={{ exact: true }}
              activeProps={{ className: activeNavItem }}
              className={navItem}
              onClick={() => setOpenMobile(false)}
              to="/"
            >
              <Icons.dashboard aria-hidden="true" />
              {t("overview")}
            </Link>
            <Link
              activeProps={{ className: activeNavItem }}
              className={navItem}
              onClick={() => setOpenMobile(false)}
              to="/donations"
            >
              <Icons.wallet aria-hidden="true" />
              {t("donations")}
            </Link>
            <Link
              activeProps={{ className: activeNavItem }}
              className={navItem}
              onClick={() => setOpenMobile(false)}
              to="/videos"
            >
              <Icons.video aria-hidden="true" />
              {t("videos")}
            </Link>
            <Link
              activeProps={{ className: activeNavItem }}
              className={navItem}
              onClick={() => setOpenMobile(false)}
              to="/integrations"
            >
              <Icons.integrations aria-hidden="true" />
              {t("integrations")}
            </Link>
            <Link
              activeProps={{ className: activeNavItem }}
              disabled
              className={navItem}
              onClick={() => setOpenMobile(false)}
              to="/alerts"
            >
              <Icons.alerts aria-hidden="true" />
              {t("alerts")}
              <Tooltip>
                <TooltipTrigger>🚧</TooltipTrigger>
                <TooltipContent>{t("underConstruction")}</TooltipContent>
              </Tooltip>
            </Link>
          </nav>

          <div className="mt-auto flex flex-col gap-5">
            <div className="flex items-center justify-between px-3">
              <Link
                aria-label={t("settings")}
                activeProps={{ className: activeNavItem }}
                className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => setOpenMobile(false)}
                to="/settings"
              >
                <Icons.settings aria-hidden="true" size={18} />
              </Link>
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger
                    aria-label={t(isDark ? "switchToLightMode" : "switchToDarkMode")}
                    aria-pressed={isDark}
                    className="grid size-8 cursor-pointer place-items-center rounded-lg border border-sidebar-border bg-background/70 text-muted-foreground transition hover:border-ring/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => toggleDark()}
                    type="button"
                  >
                    {isDark ? (
                      <Icons.sun aria-hidden="true" size={15} />
                    ) : (
                      <Icons.moon aria-hidden="true" size={15} />
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    {t(isDark ? "switchToLightMode" : "switchToDarkMode")}
                  </TooltipContent>
                </Tooltip>
                <div className="relative" ref={languageMenuRef}>
                  <Button
                    aria-expanded={isLanguageMenuOpen}
                    aria-haspopup="menu"
                    aria-label={t("language")}
                    className="size-8 rounded-lg border border-sidebar-border bg-background/70 p-0 text-base text-muted-foreground transition hover:border-ring/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => setIsLanguageMenuOpen((isOpen) => !isOpen)}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <span aria-hidden="true">{localeFlags[locale]}</span>
                  </Button>
                  {isLanguageMenuOpen && (
                    <div
                      aria-label={t("language")}
                      className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-lg border border-border bg-popover p-1 shadow-lg shadow-primary/10"
                      role="menu"
                    >
                      {(["ru", "en"] as const)
                        .filter((item) => item !== locale)
                        .map((item) => (
                          <Button
                            aria-label={t(item === "ru" ? "russian" : "english")}
                            className="size-8 rounded-md p-0 text-base hover:bg-accent"
                            key={item}
                            onClick={() => {
                              setLocale(item);
                              setIsLanguageMenuOpen(false);
                            }}
                            role="menuitem"
                            size="xs"
                            type="button"
                            variant="ghost"
                          >
                            <span aria-hidden="true">{localeFlags[item]}</span>
                          </Button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 border-t border-sidebar-border px-2 pt-5">
              {user.image ? (
                <img alt="" className="size-8 rounded-lg object-cover" src={user.image} />
              ) : (
                <div className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-[#d8a168] to-[#8a5939] text-[11px] font-bold text-white">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 grow">
                <strong className="block truncate text-xs text-sidebar-foreground">
                  {user.name}
                </strong>
                <small className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {userInfo.slug}
                </small>
              </div>
              <Tooltip>
                <TooltipTrigger
                  aria-label={t("signOut")}
                  className="cursor-pointer text-muted-foreground hover:text-primary"
                  onClick={async () => {
                    await signOut();
                    window.location.assign("/");
                  }}
                  type="button"
                >
                  <Icons.logout aria-hidden="true" size={18} />
                </TooltipTrigger>
                <TooltipContent>{t("logOut")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </aside>
      </Sidebar>
      <div className="flex min-h-0 min-w-0 grow flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 pt-[env(safe-area-inset-top)] lg:hidden">
          <SidebarTrigger
            aria-label={t("openNavigation")}
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          />
          <Link
            to="/"
            className="flex items-center gap-2 font-heading text-xl font-semibold tracking-tight text-sidebar-foreground"
          >
            <img alt="" src={logo} className="h-5" />
            coldbrew
          </Link>
        </header>
        {isDevelopmentWarningVisible && (
          <div
            className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100"
            role="alert"
          >
            <Icons.warn
              aria-hidden="true"
              className="size-5 shrink-0 text-amber-600 dark:text-amber-300"
            />
            <p className="min-w-0 grow">{t("activeDevelopment")}</p>
            <Button
              aria-label={t("dismissDevelopmentWarning")}
              onClick={() => setIsDevelopmentWarningVisible(false)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Icons.cancel aria-hidden="true" size={16} />
            </Button>
          </div>
        )}
        <div className="min-h-0 min-w-0 grow overflow-y-auto overscroll-contain">
          <div className="min-h-full w-full px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-3">
            <Suspense
              fallback={
                <div aria-busy="true" className="flex min-h-full flex-col gap-3">
                  <Skeleton className="h-8 w-52" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  );
}
