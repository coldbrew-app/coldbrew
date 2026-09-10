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

import { localeCookieName, type Locale, resolveLocale } from "./locale";

export { resolveLocale };
export type { Locale };

type TranslationValue = string | ((...args: never[]) => string);

type LocalizedMessage = {
  readonly en: TranslationValue;
  readonly ru: TranslationValue;
};

export type I18nMessages = Readonly<Record<string, LocalizedMessage>>;

type TranslationContract<English extends TranslationValue> = English extends (
  ...args: infer Args
) => string
  ? (...args: Args) => string
  : string;

type LocalizedMessageContract<Message extends LocalizedMessage> = {
  readonly en: Message["en"];
  readonly ru: TranslationContract<Message["en"]>;
} & Readonly<Record<Exclude<keyof Message, Locale>, never>>;

type I18nContract<Messages extends I18nMessages> = {
  readonly [Key in keyof Messages]: LocalizedMessageContract<Messages[Key]>;
};

export function createI18n<const Messages extends I18nMessages>(
  messages: Messages & I18nContract<Messages>,
) {
  return messages;
}

export type TranslationKey<Messages extends I18nMessages> = keyof Messages & string;
type TranslationArguments<
  Messages extends I18nMessages,
  Key extends TranslationKey<Messages>,
> = Messages[Key]["en"] extends (...args: infer Args) => string ? Args : [];
export type Translate<Messages extends I18nMessages> = <Key extends TranslationKey<Messages>>(
  key: Key,
  ...args: TranslationArguments<Messages, Key>
) => string;

export function createTranslator<const Messages extends I18nMessages>(
  locale: Locale,
  messages: Messages,
): Translate<Messages> {
  return <Key extends TranslationKey<Messages>>(
    key: Key,
    ...args: TranslationArguments<Messages, Key>
  ) => {
    const message: unknown = messages[key][locale];
    if (typeof message === "string") return message;
    if (typeof message !== "function") throw new TypeError(`Translation ${key} is not a message.`);
    const translated: unknown = Reflect.apply(message, undefined, args);
    if (typeof translated !== "string")
      throw new TypeError(`Translation ${key} did not return a string.`);
    return translated;
  };
}

type I18nContextValue = { locale: Locale; setLocale: (locale: Locale) => void };
const I18nContext = createContext<I18nContextValue | null>(null);

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
      router.update({ context: { ...router.options.context, locale: nextLocale } });
      void router.invalidate();
    },
    [router],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n<const Messages extends I18nMessages>(messages: Messages) {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return { ...context, t: createTranslator(context.locale, messages) };
}
