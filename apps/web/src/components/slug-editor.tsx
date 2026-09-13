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
  showAllVideos: { en: "Show all videos", ru: "Показать все видео" },
  settings: { en: "Settings", ru: "Настройки" },
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
  publicQueueEnabled: { en: "Link enabled", ru: "Доступ по ссылке включён" },
  publicQueueDisabled: { en: "Link disabled", ru: "Доступ по ссылке выключен" },
  saving: { en: "Saving…", ru: "Сохраняем…" },
  save: { en: "Save", ru: "Сохранить" },
  copied: { en: "Copied", ru: "Скопировано" },
  copy: { en: "Copy", ru: "Скопировать" },
});

type Props = {
  className?: string;
  showAllVideos?: boolean;
};

type SlugFormValues = {
  slug: string;
};

type SlugAction = "saving" | "save" | "copied" | "copy";

function useSlugEditor() {
  const { t } = useI18n(i18n);
  const [copied, setCopied] = useState(false);
  const userInfo = useUserInfo();
  const { formState, handleSubmit, register, reset } = useForm<SlugFormValues>({
    defaultValues: { slug: userInfo.slug },
    mode: "onChange",
  });
  const setSlugM = useSetSlugM();
  const saveSlug = async ({ slug }: SlugFormValues) => {
    await setSlugM.mutateAsync({ slug });
    reset({ slug });
    setCopied(false);
  };
  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/@${userInfo.slug}/videos`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const slugAction: SlugAction = setSlugM.isPending
    ? "saving"
    : formState.isDirty
      ? "save"
      : copied
        ? "copied"
        : "copy";

  return {
    copied,
    copyShareUrl,
    formState,
    handleSubmit,
    register,
    saveSlug,
    setCopied,
    setSlugM,
    slugAction,
    t,
    userInfo,
  };
}

type SlugEditorModel = ReturnType<typeof useSlugEditor>;

function SlugActionButton({ editor }: { editor: SlugEditorModel }) {
  const { copied, copyShareUrl, formState, setSlugM, slugAction, t } = editor;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={t(slugAction)}
            className="h-8 rounded-none border-0 border-l border-input"
            disabled={(formState.isDirty && !formState.isValid) || setSlugM.isPending}
            onClick={formState.isDirty ? undefined : () => void copyShareUrl()}
            size="icon"
            type={formState.isDirty ? "submit" : "button"}
            variant={formState.isDirty ? "default" : "ghost"}
          >
            {setSlugM.isPending ? (
              <Icons.loader aria-hidden="true" className="animate-spin" />
            ) : formState.isDirty ? (
              <Icons.save aria-hidden="true" />
            ) : copied ? (
              <Icons.copied aria-hidden="true" />
            ) : (
              <Icons.copy aria-hidden="true" />
            )}
          </Button>
        }
      />
      <TooltipContent>{t(slugAction)}</TooltipContent>
    </Tooltip>
  );
}

function SlugField({ editor }: { editor: SlugEditorModel }) {
  const { formState, register, setCopied, t } = editor;
  const hasError = Boolean(formState.errors.slug);

  return (
    <Field className="min-w-0 flex-1 sm:w-64 sm:flex-none" data-invalid={hasError}>
      <FieldLabel className="sr-only" htmlFor="public-video-queue-slug">
        {t("publicVideoQueueSlug")}
      </FieldLabel>
      <FieldDescription className="sr-only" id="slug-help">
        {t("slugHelp")}
      </FieldDescription>
      <div className="flex w-full min-w-0 overflow-hidden rounded-lg border border-input bg-background/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-[input[aria-invalid=true]]:border-destructive">
        <span
          aria-hidden="true"
          className="flex h-8 shrink-0 items-center border-r border-input px-2 text-sm font-medium text-muted-foreground select-none"
        >
          @
        </span>
        <Input
          autoComplete="off"
          aria-describedby={`slug-help${hasError ? " slug-error" : ""}`}
          aria-invalid={hasError}
          className="min-w-0 flex-1 rounded-none border-0 bg-transparent font-medium tabular-nums focus-visible:ring-0 dark:bg-transparent"
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
                setCopied(false);
              }
            },
            validate: (value) => SlugSchema.safeParse(value).success || t("slugInvalid"),
          })}
        />
        <SlugActionButton editor={editor} />
      </div>
      <FieldError errors={[formState.errors.slug]} id="slug-error" />
    </Field>
  );
}

function SettingsLink({ editor }: { editor: SlugEditorModel }) {
  const { t, userInfo } = editor;
  const enabled = userInfo.publicQueueSettings.enabled;
  const status = t(enabled ? "publicQueueEnabled" : "publicQueueDisabled");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-label={`${t("settings")}: ${status}`}
            className={buttonVariants({ className: "relative", size: "icon", variant: "ghost" })}
            to="/settings"
          >
            <Icons.settings aria-hidden="true" />
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-1 right-1 size-1.5 rounded-full ring-2 ring-background",
                enabled ? "bg-green-500" : "bg-amber-500",
              )}
            />
          </Link>
        }
      />
      <TooltipContent>
        {t("settings")} · {status}
      </TooltipContent>
    </Tooltip>
  );
}

function AllVideosLink({ editor }: { editor: SlugEditorModel }) {
  const { t } = editor;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            aria-label={t("showAllVideos")}
            className={buttonVariants({ size: "icon", variant: "default" })}
            search={{ page: 1, videoPriorityId: "all", videoStatus: "all" }}
            to="/videos"
          >
            <Icons.list aria-hidden="true" />
          </Link>
        }
      />
      <TooltipContent>{t("showAllVideos")}</TooltipContent>
    </Tooltip>
  );
}

export function SlugEditor({ className, showAllVideos = false }: Props) {
  const editor = useSlugEditor();

  return (
    <div className={cn("border-b border-border px-3 py-2 sm:px-5", className)}>
      <form className="flex flex-col gap-1.5" onSubmit={editor.handleSubmit(editor.saveSlug)}>
        <div className="flex min-w-0 items-start gap-1">
          <SlugField editor={editor} />
          <div className="flex shrink-0 items-center gap-1">
            <SettingsLink editor={editor} />
            {showAllVideos && <AllVideosLink editor={editor} />}
          </div>
        </div>
        {editor.setSlugM.error && <FieldError>{editor.setSlugM.error.message}</FieldError>}
      </form>
    </div>
  );
}
