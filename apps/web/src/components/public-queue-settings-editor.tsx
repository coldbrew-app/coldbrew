import type { PublicQueueSettings } from "@coldbrew/packages/schemas.js";
import { buttonVariants, Button } from "@web/components/ui/button";
import { FieldError } from "@web/components/ui/field";
import { Switch } from "@web/components/ui/switch";
import { useUpdatePublicQueueSettingsM, useUserInfo } from "@web/hooks/api";
import { useI18n } from "@web/lib/i18n";
import { Controller, useForm } from "react-hook-form";

import { Icons } from "./icons";

type SettingRowProps = {
  checked: boolean;
  description: string;
  disabled?: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

function SettingRow({
  checked,
  description,
  disabled = false,
  id,
  label,
  onCheckedChange,
}: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-col gap-1">
        <label className="text-sm font-medium text-card-foreground" htmlFor={id}>
          {label}
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground" id={`${id}-description`}>
          {description}
        </p>
      </div>
      <Switch
        aria-describedby={`${id}-description`}
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function PublicQueueSettingsEditor() {
  const userInfo = useUserInfo();
  const { t } = useI18n();
  const updateSettingsM = useUpdatePublicQueueSettingsM();
  const { control, formState, handleSubmit, reset, watch } = useForm<PublicQueueSettings>({
    defaultValues: userInfo.publicQueueSettings,
  });
  const enabled = watch("enabled");
  const savedEnabled = userInfo.publicQueueSettings.enabled;

  const save = async (settings: PublicQueueSettings) => {
    const savedSettings = await updateSettingsM.mutateAsync(settings);
    reset(savedSettings);
  };

  return (
    <article className="cosmic-panel overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Icons.secure aria-hidden="true" size={18} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-heading text-lg font-semibold text-card-foreground">
              {t("publicQueueSettings")}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("publicQueueSettingsDescription")}
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
          <span
            aria-hidden="true"
            className={
              savedEnabled
                ? "size-1.5 rounded-full bg-green-500"
                : "size-1.5 rounded-full bg-amber-500"
            }
          />
          {t(savedEnabled ? "publicQueueEnabled" : "publicQueueDisabled")}
        </span>
      </header>
      <form onSubmit={(event) => void handleSubmit(save)(event)}>
        <div className="divide-y divide-border">
          <Controller
            control={control}
            name="enabled"
            render={({ field }) => (
              <SettingRow
                checked={field.value}
                description={t("publicQueueEnabledDescription")}
                id="public-queue-enabled"
                label={t("publicQueueEnabledLabel")}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="showAmounts"
            render={({ field }) => (
              <SettingRow
                checked={field.value}
                description={t("publicQueueShowAmountsDescription")}
                disabled={!enabled}
                id="public-queue-show-amounts"
                label={t("publicQueueShowAmounts")}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="showWatchedVideos"
            render={({ field }) => (
              <SettingRow
                checked={field.value}
                description={t("publicQueueShowWatchedDescription")}
                disabled={!enabled}
                id="public-queue-show-watched"
                label={t("publicQueueShowWatched")}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
        <footer className="flex flex-col gap-2 border-t border-border bg-secondary/35 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <a
            className={buttonVariants({ size: "sm", variant: "ghost" })}
            href={`/videos/${userInfo.slug}`}
            rel="noreferrer"
            target="_blank"
          >
            <Icons.externalLink aria-hidden="true" />
            {t("openPublicQueue")}
          </a>
          <Button
            disabled={!formState.isDirty || updateSettingsM.isPending}
            size="sm"
            type="submit"
          >
            {t(updateSettingsM.isPending ? "saving" : "save")}
          </Button>
        </footer>
        {updateSettingsM.error && (
          <FieldError className="border-t border-border px-4 py-3 sm:px-5">
            {updateSettingsM.error.message}
          </FieldError>
        )}
      </form>
    </article>
  );
}
