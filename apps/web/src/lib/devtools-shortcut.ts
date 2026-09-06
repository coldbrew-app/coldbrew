export function getDevtoolsShortcut(userAgent: string, maxTouchPoints = 0) {
  const ua = userAgent.toLowerCase();
  const isMac = /macintosh|mac os x/.test(ua);
  if (/android|iphone|ipad|ipod|mobile/.test(ua) || (isMac && maxTouchPoints > 1)) {
    return { browser: "mobile", shortcut: null } as const;
  }
  if (/firefox\//.test(ua)) {
    return { browser: "firefox", shortcut: "Shift + F9" } as const;
  }
  if (/chrome\/|chromium\//.test(ua) && /windows|linux|cros|macintosh/.test(ua)) {
    return {
      browser: "chromium",
      shortcut: isMac ? "⌘ Command + ⌥ Option + I" : "Ctrl + Shift + I",
    } as const;
  }
  if (isMac && /version\/.*safari\//.test(ua)) {
    return { browser: "safari", shortcut: "⌘ Command + ⌥ Option + I" } as const;
  }
  return { browser: "unknown", shortcut: null } as const;
}
