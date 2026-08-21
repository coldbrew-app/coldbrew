import { useLocalStorage } from "@siberiacancode/reactuse";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
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
import { Suspense, useEffect, useRef, useState } from "react";

import logo from "../../assets/logo.svg";
import { Skeleton } from "../components/ui/skeleton";
import { signOut } from "../lib/auth-client";
import type { Locale } from "../lib/i18n";
import { I18nProvider, useI18n } from "../lib/i18n";
import type { Api } from "../lib/trpc";
import type { Viewer } from "../server/api/_util";
import { getRequestLocale } from "../server/locale";
import { getCurrentViewer } from "../server/viewer";
import PageLoadingSkeleton from "./-components/page-loading-skeleton";

import appCss from "../../styles.css?url";

const navItem =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#77758b] transition hover:bg-violet-50 hover:text-violet-700";
const activeNavItem = "bg-violet-100 font-bold text-violet-700";
const localeFlags: Record<Locale, string> = { en: "🇬🇧", ru: "🇷🇺" };

export const Route = createRootRouteWithContext<
  Api & {
    locale: Locale;
    viewer: Viewer | null;
  }
>()({
  beforeLoad: async () => {
    const [locale, viewer] = await Promise.all([getRequestLocale(), getCurrentViewer()]);
    return { locale, viewer };
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
  const { locale } = Route.useRouteContext();

  return (
    <html lang={locale}>
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

function useDark() {
  const theme = useLocalStorage<"light" | "dark">("theme", "light");
  const isDark = theme.value == "dark";
  const toggleDark = () => theme.set(theme.value == "dark" ? "light" : "dark");
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
  const { viewer } = Route.useRouteContext();
  const { isDark, toggleDark } = useDark();
  const { locale, setLocale, t } = useI18n();
  const { setOpenMobile } = useSidebar();
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
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
    <main className="flex h-dvh w-full min-w-0 bg-[#f7f7fb] font-sans text-[#242238] transition-colors duration-300 dark:bg-[#11111a] dark:text-[#f1efff]">
      <Sidebar>
        <aside className="flex size-full flex-col border-r border-[#ebeaf1] bg-white px-4 pt-8 pb-5 transition-colors duration-300 dark:border-white/10 dark:bg-[#181722]">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2.5 px-1 text-xl font-bold tracking-tight text-[#292640] dark:text-white"
            >
              <img src={logo} className="h-[24px]" />
              Coldbrew
            </Link>
          </div>
          <nav className="mt-11 grid gap-1" aria-label={t("overview")}>
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
                className="grid size-8 place-items-center rounded-lg text-[#77758b] transition hover:bg-violet-50 hover:text-violet-700"
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
                    className="grid size-8 cursor-pointer place-items-center rounded-lg border border-[#e8e6ef] bg-[#faf9fc] text-[#6d697d] transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-white/10 dark:bg-white/5 dark:text-violet-100 dark:hover:border-violet-400/40 dark:hover:bg-violet-400/10 dark:hover:text-white"
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
                    className="size-8 rounded-lg border border-[#e8e6ef] bg-[#faf9fc] p-0 text-base text-[#6d697d] transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-white/10 dark:bg-white/5 dark:text-violet-100 dark:hover:border-violet-400/40 dark:hover:bg-violet-400/10 dark:hover:text-white"
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
                      className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-lg border border-[#e8e6ef] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#24202d]"
                      role="menu"
                    >
                      {(["ru", "en"] as const)
                        .filter((item) => item !== locale)
                        .map((item) => (
                          <Button
                            aria-label={t(item === "ru" ? "russian" : "english")}
                            className="size-8 rounded-md p-0 text-base hover:bg-violet-50 dark:hover:bg-violet-400/10"
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
            <div className="flex items-center gap-2.5 border-t border-[#eeedf2] px-2 pt-5 dark:border-white/10">
              {user.image ? (
                <img alt="" className="size-8 rounded-lg object-cover" src={user.image} />
              ) : (
                <div className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-orange-300 to-orange-500 text-[11px] font-bold text-white">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 grow">
                <strong className="block truncate text-xs text-[#373449]">{user.name}</strong>
                <small className="mt-0.5 block truncate text-[10px] text-[#9391a1]">
                  {userInfo.slug}
                </small>
              </div>
              <Tooltip>
                <TooltipTrigger
                  aria-label={t("signOut")}
                  className="cursor-pointer text-[#9694a3] hover:text-violet-700"
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
      <div className="flex min-h-0 grow flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#ebeaf1] bg-white px-3 pt-[env(safe-area-inset-top)] dark:border-white/10 dark:bg-[#181722] lg:hidden">
          <SidebarTrigger
            aria-label={t("openNavigation")}
            className="text-[#595565] hover:bg-violet-50 hover:text-violet-700 dark:text-violet-100 dark:hover:bg-violet-400/10 dark:hover:text-white"
          />
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-[#292640] dark:text-white"
          >
            <img alt="" src={logo} className="h-5" />
            coldbrew
          </Link>
        </header>
        <div
          className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100"
          role="alert"
        >
          <Icons.warn
            aria-hidden="true"
            className="size-5 shrink-0 text-amber-600 dark:text-amber-300"
          />
          <p>{t("activeDevelopment")}</p>
        </div>
        <div className="min-h-0 grow overflow-y-auto overscroll-contain">
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
