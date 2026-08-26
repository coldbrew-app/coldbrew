import { SlugSchema } from "@coldbrew/packages/schemas.js";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@web/components/ui/button";
import { useSetSlugM, useUserInfo } from "@web/hooks/api";
import { cn } from "@web/lib/utils";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

type Props = {
  className?: string;
};

type SlugFormValues = {
  slug: string;
};

export function SlugEditor({ className }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const userInfo = useUserInfo();
  if (userInfo === null) throw new Error("Authenticated user info is required.");
  const { slug } = userInfo;

  useEffect(() => setOrigin(window.location.origin), []);

  const { formState, handleSubmit, register, reset } = useForm<SlugFormValues>({
    defaultValues: { slug },
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
      await navigator.clipboard.writeText(`${window.location.origin}/share/${slug}`);
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Field className="min-w-0 grow" data-invalid={Boolean(formState.errors.slug)}>
            <FieldLabel className="sr-only" htmlFor="public-video-queue-slug">
              {t("publicVideoQueueSlug")}
            </FieldLabel>
            <FieldDescription className="sr-only" id="slug-help">
              {t("slugHelp")}
            </FieldDescription>
            <div className="flex min-w-0 rounded-lg border border-input bg-background/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-[input[aria-invalid=true]]:border-destructive">
              <span className="shrink-0 border-r border-input px-2.5 py-1.5 text-sm text-muted-foreground">
                {origin}/share/
              </span>
              <Input
                autoComplete="off"
                aria-describedby={`slug-help${formState.errors.slug ? " slug-error" : ""}`}
                aria-invalid={Boolean(formState.errors.slug)}
                className="min-w-0 grow rounded-none border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent"
                id="public-video-queue-slug"
                maxLength={48}
                {...register("slug", {
                  onChange: (event) => {
                    const value = event.target.value.toLowerCase();
                    event.target.value = value.startsWith("@") ? value : `@${value}`;
                  },
                  validate: (value) => SlugSchema.safeParse(value).success || t("slugInvalid"),
                })}
              />
            </div>
            <FieldError errors={[formState.errors.slug]} id="slug-error" />
          </Field>
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={!formState.isValid || !formState.isDirty || setSlugM.isPending}
              size="sm"
              type="submit"
            >
              {t(setSlugM.isPending ? "saving" : "save")}
            </Button>
            <Button onClick={() => void copyShareUrl()} size="sm" type="button" variant="outline">
              {copied ? <Icons.copied aria-hidden="true" /> : <Icons.copy aria-hidden="true" />}
              {t(copied ? "copied" : "copy")}
            </Button>
            <Link className={buttonVariants({ size: "sm", variant: "ghost" })} to="/settings">
              <Icons.settings aria-hidden="true" />
              {t("settings")}
            </Link>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <span
            aria-hidden="true"
            className={
              userInfo.publicQueueSettings.enabled
                ? "size-1.5 rounded-full bg-green-500"
                : "size-1.5 rounded-full bg-amber-500"
            }
          />
          {t(userInfo.publicQueueSettings.enabled ? "publicQueueEnabled" : "publicQueueDisabled")}
        </span>
        {setSlugM.error && <FieldError>{setSlugM.error.message}</FieldError>}
      </form>
    </div>
  );
}
