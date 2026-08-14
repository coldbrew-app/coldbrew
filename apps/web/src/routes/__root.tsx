import { useLocalStorage } from "@siberiacancode/reactuse";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { Icons } from "@web/components/icons";
import SignIn from "@web/components/sign-in";
import { Button } from "@web/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@web/components/ui/tooltip";
import { useUserInfo } from "@web/hooks/api";
import { useEffect, useRef, useState } from "react";

import logo from "../../assets/logo.svg";
import { signOut, useSession } from "../lib/auth-client";
import type { Locale } from "../lib/i18n";
import { I18nProvider, useI18n } from "../lib/i18n";

import appCss from "../../styles.css?url";

const navItem =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#77758b] transition hover:bg-violet-50 hover:text-violet-700";
const activeNavItem = "bg-violet-100 font-bold text-violet-700";
const localeFlags: Record<Locale, string> = { en: "🇬🇧", ru: "🇷🇺" };

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
    ],
    links: [{ href: appCss, rel: "stylesheet" }],
    title: "omnistream",
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider>
          <TooltipProvider>
            <Application />
          </TooltipProvider>
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

function Application() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => setHasHydrated(true), []);

  if (!hasHydrated) return <main className="min-h-screen bg-[#f7f7fb]" />;
  return <Root />;
}

function useDark() {
  const theme = useLocalStorage<"light" | "dark">("theme", "light");
  const isDark = theme.value == "dark";
  const toggleDark = () => theme.set(theme.value == "dark" ? "light" : "dark");
  return { isDark, toggleDark };
}

function Root() {
  const session = useSession();
  const { isDark, toggleDark } = useDark();
  const { locale, setLocale, t } = useI18n();
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
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

  if (pathname.startsWith("/share/")) {
    return <Outlet />;
  }

  if (session.isPending) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f7fb]" />;
  }

  if (!session.data || !userInfo) {
    return <SignIn />;
  }

  const user = session.data.user;

  return (
    <main className="flex h-screen min-w-80 bg-[#f7f7fb] font-sans text-[#242238] transition-colors duration-300 dark:bg-[#11111a] dark:text-[#f1efff]">
      <aside className="hidden w-[244px] shrink-0 flex-col border-r border-[#ebeaf1] bg-white px-4 pt-8 pb-5 transition-colors duration-300 lg:flex dark:border-white/10 dark:bg-[#181722]">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-2.5 px-1 text-xl font-bold tracking-tight text-[#292640] dark:text-white"
          >
            <img src={logo} className="h-[24px]" />
            omnistream
          </Link>
        </div>
        <nav className="mt-11 grid gap-1" aria-label={t("overview")}>
          <Link
            activeOptions={{ exact: true }}
            activeProps={{ className: activeNavItem }}
            className={navItem}
            to="/"
          >
            <Icons.dashboard aria-hidden="true" />
            {t("overview")}
          </Link>
          <Link activeProps={{ className: activeNavItem }} className={navItem} to="/donations">
            <Icons.wallet aria-hidden="true" />
            {t("donations")}
          </Link>
          <Link activeProps={{ className: activeNavItem }} className={navItem} to="/integrations">
            <Icons.integrations aria-hidden="true" />
            {t("integrations")}
          </Link>
          <Link
            activeProps={{ className: activeNavItem }}
            disabled
            className={navItem}
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
      <div className="flex min-h-0 grow flex-col">
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
        <div className="min-h-0 grow overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
