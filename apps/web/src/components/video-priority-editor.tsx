import { MoneyAmountSchema, VideoPriority } from "@coldbrew/packages/schemas.js";
import { getRoundedWatchDurationMinutes } from "@coldbrew/packages/video-timing.js";
import { Link } from "@tanstack/react-router";
import { useUpdateVideoPriorityM, useUserInfo } from "@web/hooks/api";
import { cn } from "@web/lib/utils";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

type VideoPriorityFormValues = {
  label: string;
  minPricePerMinute: string;
};

type Props = {
  priority: VideoPriority;
  isSelected: boolean;
  remainingSeconds: number;
  videoCount: number;
};

export default function VideoPriorityEditor({
  priority,
  isSelected,
  remainingSeconds,
  videoCount,
}: Props) {
  const { t } = useI18n();
  const userInfo = useUserInfo();
  if (userInfo === null) throw new Error("Authenticated user info is required.");
  const [isEditing, setIsEditing] = useState(false);
  const updateVideoPriorityM = useUpdateVideoPriorityM();
  const { formState, handleSubmit, register, reset } = useForm<VideoPriorityFormValues>({
    defaultValues: {
      label: priority.label,
      minPricePerMinute: priority.minPricePerMinute,
    },
    mode: "onChange",
  });

  const savePriority = async (values: VideoPriorityFormValues) => {
    const updatedPriority = await updateVideoPriorityM.mutateAsync({
      videoPriorityId: priority.videoPriorityId,
      ...values,
    });
    reset({ label: updatedPriority.label, minPricePerMinute: updatedPriority.minPricePerMinute });
    setIsEditing(false);
  };

  const startEditing = () => {
    reset({
      label: priority.label,
      minPricePerMinute: priority.minPricePerMinute,
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    reset({
      label: priority.label,
      minPricePerMinute: priority.minPricePerMinute,
    });
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <div
        className={cn(
          "relative flex items-center gap-2 rounded-lg border px-2 py-1.5",
          isSelected
            ? "border-ring/35 bg-secondary hover:bg-accent"
            : "border-border bg-card hover:bg-muted",
        )}
      >
        <Link
          aria-label={t("selectQueueFilter", { label: priority.label })}
          className="absolute inset-0 rounded-lg"
          search={(previous) => ({
            page: 1,
            videoPriorityId: priority.videoPriorityId,
            videoStatus: previous.videoStatus ?? "all",
          })}
          to="/videos"
        />
        <Button
          aria-label={t("editQueue")}
          className="pointer-events-auto relative"
          onClick={startEditing}
          size="icon-xs"
          type="button"
          variant="outline"
        >
          <Icons.edit aria-hidden="true" />
        </Button>
        <div className="pointer-events-none flex min-w-0 grow flex-col gap-0.5 px-1.5 py-1 text-left">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <span className="min-w-0 grow truncate">{priority.label}</span>
            <span className="shrink-0 text-[10px] font-bold">{videoCount}</span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="truncate">
              {priority.minPricePerMinute} {userInfo.queueCurrency}/{t("perMinute")}
            </span>
            <span className="shrink-0 font-semibold text-primary">
              {t("minutesRemaining", {
                count: getRoundedWatchDurationMinutes(remainingSeconds),
              })}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const errorId = `video-priority-error-${priority.videoPriorityId}`;

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-2 py-1.5"
      onSubmit={(event) => void handleSubmit(savePriority)(event)}
    >
      <div className="flex items-center gap-2">
        <Button
          aria-label={t("cancelEditing")}
          disabled={updateVideoPriorityM.isPending}
          onClick={cancelEditing}
          size="icon-xs"
          type="button"
          variant="outline"
        >
          <Icons.cancel aria-hidden="true" />
        </Button>
        <Field className="min-w-0 grow gap-0" data-invalid={Boolean(formState.errors.label)}>
          <FieldLabel className="sr-only" htmlFor={`priority-label-${priority.videoPriorityId}`}>
            {t("name")}
          </FieldLabel>
          <Input
            autoComplete="off"
            aria-describedby={formState.errors.label ? errorId : undefined}
            aria-invalid={Boolean(formState.errors.label)}
            className="h-6 rounded-md px-2 text-xs md:text-xs"
            id={`priority-label-${priority.videoPriorityId}`}
            maxLength={64}
            {...register("label", { required: t("enterQueueName") })}
          />
        </Field>
        <Field
          className="w-20 shrink-0 gap-0"
          data-invalid={Boolean(formState.errors.minPricePerMinute)}
        >
          <FieldLabel className="sr-only" htmlFor={`priority-amount-${priority.videoPriorityId}`}>
            {t("minimumAmountPerMinute")}
          </FieldLabel>
          <Input
            autoComplete="off"
            aria-describedby={formState.errors.minPricePerMinute ? errorId : undefined}
            aria-invalid={Boolean(formState.errors.minPricePerMinute)}
            className="h-6 rounded-md px-2 text-xs md:text-xs"
            id={`priority-amount-${priority.videoPriorityId}`}
            min="0"
            step="any"
            type="number"
            {...register("minPricePerMinute", {
              required: t("enterMinimumAmount"),
              validate: (value) =>
                MoneyAmountSchema.safeParse(value).success || t("enterAmountZeroOrMore"),
            })}
          />
        </Field>
        <Button
          aria-label={t(updateVideoPriorityM.isPending ? "savingQueue" : "saveQueue")}
          disabled={!formState.isValid || !formState.isDirty || updateVideoPriorityM.isPending}
          size="icon-xs"
          type="submit"
        >
          <Icons.checked aria-hidden="true" />
        </Button>
      </div>
      {(formState.errors.label || formState.errors.minPricePerMinute) && (
        <FieldError
          className="text-[10px]"
          errors={[formState.errors.label, formState.errors.minPricePerMinute]}
          id={errorId}
        />
      )}
      {updateVideoPriorityM.error && (
        <FieldError className="text-[10px]">{updateVideoPriorityM.error.message}</FieldError>
      )}
    </form>
  );
}
