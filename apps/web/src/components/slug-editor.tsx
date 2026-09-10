import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@web/components/ui/button";
import { useSetSlugM, useUserInfo } from "@web/hooks/api";
import { cn } from "@web/lib/utils";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { createI18n, useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const i18n = createI18n({
  showAllVideos: {
    en: "Show all videos",
    ru: "Показать все видео",
  },
  settings: {
    en: "Settings",
    ru: "Настройки",
  },
  publicVideoQueueSlug: {
    en: "Public video queue handle",
    ru: "Адрес публичной очереди видео",
  },
  slugHelp: {
    en: "Use 3–47 lowercase letters, numbers, or hyphens.",
    ru: "Используйте от 3 до 47 строчных латинских букв, цифр или дефисов.",
  },
  slugInvalid: {
    en: "Use 3–47 lowercase letters, numbers, or hyphens.",
    ru: "Введите от 3 до 47 строчных латинских букв, цифр или дефисов.",
  },
  publicQueueEnabled: {
    en: "Link enabled",
    ru: "Доступ по ссылке включён",
  },
  publicQueueDisabled: {
    en: "Link disabled",
    ru: "Доступ по ссылке выключен",
  },
  saving: {
    en: "Saving…",
    ru: "Сохраняем…",
  },
  save: {
    en: "Save",
    ru: "Сохранить",
  },
  copied: {
    en: "Copied",
    ru: "Скопировано",
  },
  copy: {
    en: "Copy",
    ru: "Скопировать",
  },
});

type Props = {
  className?: string;
  showAllVideos?: boolean;
};

type SlugFormValues = {
  slug: string;
};

export function SlugEditor({ className, showAllVideos = false }: Props) {
  const { t } = useI18n(i18n);
  const [copied, setCopied] = useState(false);
  const userInfo = useUserInfo();
  const { slug } = userInfo;

  const { formState, handleSubmit, register, reset } = useForm<SlugFormValues>({
    defaultValues: { slug },
    mode: "onChange",
  });

  const setSlugM = useSetSlugM();
  const saveSlug = async ({ slug: nextSlug }: SlugFormValues) => {
    await setSlugM.mutateAsync({ slug: nextSlug });
    reset({ slug: nextSlug });
    setCopied(false);
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/@${slug}/videos`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cn("border-b border-border p-3 sm:px-5", className)}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => void handleSubmit(saveSlug)(event)}
      >
        <div className="flex items-start gap-2">
          <Field className="min-w-0 grow" data-invalid={Boolean(formState.errors.slug)}>
            <FieldLabel className="sr-only" htmlFor="public-video-queue-slug">
              {t("publicVideoQueueSlug")}
            </FieldLabel>
            <FieldDescription className="sr-only" id="slug-help">
              {t("slugHelp")}
            </FieldDescription>
            <div className="flex min-w-0 rounded-lg border border-input bg-background/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-[input[aria-invalid=true]]:border-destructive">
              <Input
                autoComplete="off"
                aria-describedby={`slug-help${formState.errors.slug ? " slug-error" : ""}`}
                aria-invalid={Boolean(formState.errors.slug)}
                className="min-w-0 grow border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent"
                id="public-video-queue-slug"
                maxLength={47}
                {...register("slug", {
                  onChange: (event: unknown) => {
                    if (
                      typeof event === "object" &&
                      event !== null &&
                      "target" in event &&
                      event.target instanceof HTMLInputElement
                    ) {
                      event.target.value = event.target.value.toLowerCase();
                    }
                  },
                  validate: (value) => SlugSchema.safeParse(value).success || t("slugInvalid"),
                })}
              />
            </div>
            <FieldError errors={[formState.errors.slug]} id="slug-error" />
          </Field>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t(setSlugM.isPending ? "saving" : "save")}
                    disabled={!formState.isValid || !formState.isDirty || setSlugM.isPending}
                    size="icon"
                    type="submit"
                  >
                    {setSlugM.isPending ? (
                      <Icons.loader aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Icons.save aria-hidden="true" />
                    )}
                  </Button>
                }
              />
              <TooltipContent>{t(setSlugM.isPending ? "saving" : "save")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t(copied ? "copied" : "copy")}
                    onClick={() => void copyShareUrl()}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    {copied ? (
                      <Icons.copied aria-hidden="true" />
                    ) : (
                      <Icons.copy aria-hidden="true" />
                    )}
                  </Button>
                }
              />
              <TooltipContent>{t(copied ? "copied" : "copy")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                aria-label={t(
                  userInfo.publicQueueSettings.enabled
                    ? "publicQueueEnabled"
                    : "publicQueueDisabled",
                )}
                className="grid size-8 place-items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                tabIndex={0}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={
                    userInfo.publicQueueSettings.enabled
                      ? "size-2 rounded-full bg-green-500"
                      : "size-2 rounded-full bg-amber-500"
                  }
                />
              </TooltipTrigger>
              <TooltipContent>
                {t(
                  userInfo.publicQueueSettings.enabled
                    ? "publicQueueEnabled"
                    : "publicQueueDisabled",
                )}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    aria-label={t("settings")}
                    className={buttonVariants({
                      size: "icon",
                      variant: "ghost",
                    })}
                    to="/settings"
                  >
                    <Icons.settings aria-hidden="true" />
                  </Link>
                }
              />
              <TooltipContent>{t("settings")}</TooltipContent>
            </Tooltip>
            {showAllVideos && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      aria-label={t("showAllVideos")}
                      className={buttonVariants({
                        size: "icon",
                        variant: "default",
                      })}
                      search={{
                        page: 1,
                        videoPriorityId: "all",
                        videoStatus: "all",
                      }}
                      to="/videos"
                    >
                      <Icons.list aria-hidden="true" />
                    </Link>
                  }
                />
                <TooltipContent>{t("showAllVideos")}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {setSlugM.error && <FieldError>{setSlugM.error.message}</FieldError>}
      </form>
    </div>
  );
}
