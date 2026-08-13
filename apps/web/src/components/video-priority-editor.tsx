import { useUpdateVideoPriorityM } from "@web/hooks/api";
import { cn } from "@web/lib/utils";
import { VideoPriority } from "@omnistream/packages/schemas.js";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Button } from "./ui/button";

type VideoPriorityFormValues = {
  label: string;
  minPricePerMinute: number;
};

type Props = {
  priority: VideoPriority;
  isSelected: boolean;
  videoCount: number;
};

export default function VideoPriorityEditor({ priority, isSelected, videoCount }: Props) {
  const { t } = useI18n();
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
    reset(updatedPriority);
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
            ? "border-violet-200 bg-violet-100 hover:bg-violet-200 dark:border-violet-400/40 dark:bg-violet-400/20 dark:hover:bg-violet-400/30"
            : "border-[#e5e3ea] bg-white hover:bg-[#f3f1f6] dark:border-[#393442] dark:bg-[#24202d] dark:hover:bg-[#2b2735]",
        )}
      >
        <Link
          aria-label={t("selectQueueFilter", { label: priority.label })}
          className="absolute inset-0 rounded-lg"
          search={(previous) => ({
            videoPriorityId: priority.videoPriorityId,
            videoStatus: previous.videoStatus ?? "all",
          })}
          to="/donations/videos"
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
            {priority.minPricePerMinute} ₽/{t("perMinute")}
          </span>
          <span className="shrink-0 text-[10px] font-bold">{videoCount}</span>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-[#e5e3ea] bg-white px-2 py-1.5 dark:border-[#393442] dark:bg-[#24202d]"
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
            className="h-6 w-full rounded-md border border-[#e5e3ea] bg-transparent px-2 text-xs text-[#353248] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-[#4a4455] dark:text-[#e4dfed]"
            maxLength={64}
            {...register("label", { required: t("enterQueueName") })}
          />
        </label>
        <label className="w-20 shrink-0">
          <span className="sr-only">{t("minimumAmountPerMinute")}</span>
          <input
            autoComplete="off"
            aria-invalid={Boolean(formState.errors.minPricePerMinute)}
            className="h-6 w-full rounded-md border border-[#e5e3ea] bg-transparent px-2 text-xs text-[#353248] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-[#4a4455] dark:text-[#e4dfed]"
            min="0"
            step="any"
            type="number"
            {...register("minPricePerMinute", {
              required: t("enterMinimumAmount"),
              valueAsNumber: true,
              validate: (value) =>
                (Number.isFinite(value) && value >= 0) || t("enterAmountZeroOrMore"),
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
