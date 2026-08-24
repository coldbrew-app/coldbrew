import { MoneyAmountSchema, VideoPriority } from "@coldbrew/packages/schemas.js";
import { Link } from "@tanstack/react-router";
import { useUpdateVideoPriorityM, useUserInfo } from "@web/hooks/api";
import { cn } from "@web/lib/utils";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Button } from "./ui/button";

type VideoPriorityFormValues = {
  label: string;
  minPricePerMinute: string;
};

type Props = {
  priority: VideoPriority;
  isSelected: boolean;
  videoCount: number;
};

export default function VideoPriorityEditor({ priority, isSelected, videoCount }: Props) {
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
        <div className="pointer-events-none flex min-w-0 grow items-center gap-2 px-1.5 py-1 text-left text-xs">
          <span className="min-w-0 grow truncate">{priority.label}</span>
          <span className="w-20 shrink-0 text-right">
            {priority.minPricePerMinute} {userInfo.queueCurrency}/{t("perMinute")}
          </span>
          <span className="shrink-0 text-[10px] font-bold">{videoCount}</span>
        </div>
      </div>
    );
  }

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
        <label className="min-w-0 grow">
          <span className="sr-only">{t("name")}</span>
          <input
            autoComplete="off"
            aria-invalid={Boolean(formState.errors.label)}
            className="h-6 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            maxLength={64}
            {...register("label", { required: t("enterQueueName") })}
          />
        </label>
        <label className="w-20 shrink-0">
          <span className="sr-only">{t("minimumAmountPerMinute")}</span>
          <input
            autoComplete="off"
            aria-invalid={Boolean(formState.errors.minPricePerMinute)}
            className="h-6 w-full rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            min="0"
            step="any"
            type="number"
            {...register("minPricePerMinute", {
              required: t("enterMinimumAmount"),
              validate: (value) =>
                MoneyAmountSchema.safeParse(value).success || t("enterAmountZeroOrMore"),
            })}
          />
        </label>
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
        <p className="text-[10px] text-red-600" role="alert">
          {formState.errors.label?.message ?? formState.errors.minPricePerMinute?.message}
        </p>
      )}
      {updateVideoPriorityM.error && (
        <p className="text-[10px] text-red-600" role="alert">
          {updateVideoPriorityM.error.message}
        </p>
      )}
    </form>
  );
}
