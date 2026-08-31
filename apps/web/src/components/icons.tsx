import type { ChatProvider } from "@coldbrew/packages/chat.js";
import * as icons from "lucide-react";

import boostyLogo from "../../assets/chat-providers/boosty.svg";
import kickLogo from "../../assets/chat-providers/kick.svg";
import twitchLogo from "../../assets/chat-providers/twitch.svg";
import vkLogo from "../../assets/chat-providers/vk.svg";
import youtubeLogo from "../../assets/chat-providers/youtube.svg";

export type IconComponent = icons.LucideIcon;

export const PlatformIcons = {
  youtube: youtubeLogo,
  twitch: twitchLogo,
  kick: kickLogo,
  boosty: boostyLogo,
  vk_video: vkLogo,
} as const satisfies Record<ChatProvider, string>;

export const Icons = {
  addVideo: icons.ListPlus,
  alerts: icons.Bell,
  ban: icons.Ban,
  chat: icons.MessagesSquare,
  addSource: icons.Plus,
  bookmark: icons.Bookmark,
  cancel: icons.X,
  checked: icons.Check,
  chevronDown: icons.ChevronDown,
  chevronLeft: icons.ChevronLeft,
  chevronRight: icons.ChevronRight,
  copied: icons.Check,
  copy: icons.Copy,
  dashboard: icons.LayoutDashboard,
  dateRange: icons.ChevronDown,
  donations: icons.Sparkles,
  edit: icons.Pencil,
  externalLink: icons.ExternalLink,
  filter: icons.SlidersHorizontal,
  greetingAccent: icons.Sparkles,
  help: icons.CircleHelp,
  integrations: icons.Plug,
  list: icons.List,
  loader: icons.LoaderCircle,
  logout: icons.LogOut,
  moon: icons.Moon,
  manualVideo: icons.UserRoundPlus,
  notWatched: icons.Circle,
  platform: icons.Share2,
  retry: icons.RotateCcw,
  removeSource: icons.Trash2,
  rotateToken: icons.RefreshCw,
  unread: icons.ArrowDown,
  search: icons.Search,
  send: icons.Send,
  secure: icons.ShieldCheck,
  settings: icons.Settings,
  submit: icons.Check,
  timeout: icons.TimerOff,
  unban: icons.UserRoundCheck,
  sun: icons.Sun,
  video: icons.Video,
  videoFromDonation: icons.Sparkles,
  wallet: icons.Wallet,
  warn: icons.TriangleAlert,
  watched: icons.CheckCircle2,
};
