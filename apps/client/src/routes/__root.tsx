import { Link, Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  LayoutDashboard,
  LogOut,
  Moon,
  Plug,
  Settings,
  Sun,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useEffect } from "react";

import logo from "../../assets/logo.svg";
import { signOut, useSession } from "../lib/auth-client";

const navItem =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#77758b] transition hover:bg-violet-50 hover:text-violet-700";
const activeNavItem = "bg-violet-100 font-bold text-violet-700";

export const Route = createRootRoute({
  component: Root,
});

import SignIn from "@client/components/sign-in";
import { Tooltip, TooltipContent, TooltipTrigger } from "@client/components/ui/tooltip";
import { useUserInfo } from "@client/hooks/api";
import { useLocalStorage } from "@siberiacancode/reactuse";

function useDark() {
  const theme = useLocalStorage<"light" | "dark">("theme", "light");
  const isDark = theme.value == "dark";
  const toggleDark = () => theme.set(theme.value == "dark" ? "light" : "dark");
  return { isDark, toggleDark };
}

function Root() {
  const session = useSession();
  const { isDark, toggleDark } = useDark();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const userInfo = useUserInfo();

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

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
          <Tooltip>
            <TooltipTrigger
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={isDark}
              className="ml-auto grid size-8 cursor-pointer place-items-center rounded-lg border border-[#e8e6ef] bg-[#faf9fc] text-[#6d697d] shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-white/10 dark:bg-white/5 dark:text-violet-100 dark:hover:border-violet-400/40 dark:hover:bg-violet-400/10 dark:hover:text-white"
              onClick={() => toggleDark()}
              type="button"
            >
              {isDark ? (
                <Sun aria-hidden="true" size={15} />
              ) : (
                <Moon aria-hidden="true" size={15} />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {isDark ? "Switch to light mode" : "Switch to dark mode"}
            </TooltipContent>
          </Tooltip>
        </div>
        <nav className="mt-11 grid gap-1" aria-label="Main navigation">
          <Link
            activeOptions={{ exact: true }}
            activeProps={{ className: activeNavItem }}
            className={navItem}
            to="/"
          >
            <LayoutDashboard aria-hidden="true" />
            Overview
          </Link>
          <Link activeProps={{ className: activeNavItem }} className={navItem} to="/donations">
            <Wallet aria-hidden="true" />
            Donations
          </Link>
          <Link activeProps={{ className: activeNavItem }} className={navItem} to="/integrations">
            <Plug aria-hidden="true" />
            Integrations
            <span className="ml-auto grid size-[18px] place-items-center rounded-full bg-violet-500 text-[11px] text-white">
              1
            </span>
          </Link>
          <Link
            activeProps={{ className: activeNavItem }}
            disabled
            className={navItem}
            to="/alerts"
          >
            <Bell aria-hidden="true" />
            Alerts
            <Tooltip>
              <TooltipTrigger>🚧</TooltipTrigger>
              <TooltipContent>Under construction</TooltipContent>
            </Tooltip>
          </Link>
        </nav>

        <div className="mt-auto flex flex-col gap-5">
          <Link activeProps={{ className: activeNavItem }} className={navItem} to="/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
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
                aria-label="Sign out"
                className="cursor-pointer text-[#9694a3] hover:text-violet-700"
                onClick={() => signOut()}
                type="button"
              >
                <LogOut aria-hidden="true" size={18} />
              </TooltipTrigger>
              <TooltipContent>Log Out</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
      <div className="flex min-h-0 grow flex-col">
        <div
          className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100"
          role="alert"
        >
          <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-amber-600 dark:text-amber-300" />
          <p>
            Omnistream is in active development. Breaking changes are expected, and your data may be
            lost.
          </p>
        </div>
        <div className="min-h-0 grow overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
