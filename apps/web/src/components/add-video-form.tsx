import { MoneyAmountSchema } from "@coldbrew/packages/schemas.js";
import {
  formatVideoTime,
  getWatchDurationSeconds,
  parseVideoTime,
} from "@coldbrew/packages/video-timing.js";
import { youtubeVideoId } from "@coldbrew/packages/youtube.js";
import { useAddVideoM, useUserInfo } from "@web/hooks/api";
import { useI18n } from "@web/lib/i18n";
import { useForm } from "react-hook-form";

import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Props = {
  onCancel: () => void;
};

type AddVideoFormValues = {
  url: string;
  amount: string;
  startTime: string;
  endTime: string;
};

export function AddVideoForm({ onCancel }: Props) {
  const { t } = useI18n();
  const userInfo = useUserInfo();
  const addVideoM = useAddVideoM();
  const timingHelpId = "manual-video-timing-help";
  const { formState, getValues, handleSubmit, register, reset, trigger, watch } =
    useForm<AddVideoFormValues>({
      defaultValues: { url: "", amount: "0.00", startTime: "0:00", endTime: "" },
      mode: "onChange",
    });
  const startSeconds = parseVideoTime(watch("startTime"));
  const endTime = watch("endTime");
  const endSeconds = parseVideoTime(endTime);
  const watchDuration =
    startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
      ? formatVideoTime(getWatchDurationSeconds(startSeconds, endSeconds))
      : null;

  const addVideo = async ({ url, amount, startTime, endTime }: AddVideoFormValues) => {
    const startSeconds = parseVideoTime(startTime);
    const endSeconds = endTime.trim() === "" ? null : parseVideoTime(endTime);
    if (startSeconds === null || (endTime.trim() !== "" && endSeconds === null)) return;

    try {
      await addVideoM.mutateAsync({ url: url.trim(), amount, startSeconds, endSeconds });
      reset();
      onCancel();
    } catch {
      // The mutation error is rendered below the form.
    }
  };

  return (
    <div className="border-b border-border bg-secondary/35 p-4 sm:px-5" id="add-video-form">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => void handleSubmit(addVideo)(event)}
      >
        <div className="grid gap-3 md:grid-cols-2 md:items-end xl:grid-cols-[minmax(0,1fr)_11rem_8rem_8rem_auto]">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">{t("manualVideoUrl")}</span>
            <Input
              aria-invalid={Boolean(formState.errors.url)}
              autoFocus
              disabled={addVideoM.isPending}
              placeholder="https://youtu.be/…"
              type="url"
              {...register("url", {
                required: t("enterYoutubeUrl"),
                validate: (url) => youtubeVideoId(url.trim()) !== null || t("invalidYoutubeUrl"),
              })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">{t("amount")}</span>
            <div className="flex rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
              <input
                aria-invalid={Boolean(formState.errors.amount)}
                className="h-8 min-w-0 grow bg-transparent px-2.5 py-1 text-sm text-foreground outline-none"
                disabled={addVideoM.isPending}
                min="0"
                step="any"
                type="number"
                {...register("amount", {
                  required: t("enterPriorityAmount"),
                  validate: (amount) =>
                    MoneyAmountSchema.safeParse(amount).success || t("enterAmountZeroOrMore"),
                })}
              />
              <span className="flex shrink-0 items-center border-l border-input px-2.5 text-xs font-semibold text-muted-foreground">
                {userInfo?.queueCurrency}
              </span>
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">{t("videoStart")}</span>
            <Input
              aria-describedby={timingHelpId}
              aria-invalid={Boolean(formState.errors.startTime)}
              autoComplete="off"
              disabled={addVideoM.isPending}
              inputMode="numeric"
              placeholder="0:00"
              type="text"
              {...register("startTime", {
                required: t("enterVideoTime"),
                validate: (value) => parseVideoTime(value) !== null || t("invalidVideoTime"),
                onChange: () => void trigger("endTime"),
              })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">{t("videoEnd")}</span>
            <Input
              aria-describedby={timingHelpId}
              aria-invalid={Boolean(formState.errors.endTime)}
              autoComplete="off"
              disabled={addVideoM.isPending}
              inputMode="numeric"
              placeholder={t("videoEndPlaceholder")}
              type="text"
              {...register("endTime", {
                validate: (value) => {
                  if (value.trim() === "") return true;
                  const endSeconds = parseVideoTime(value);
                  if (endSeconds === null) return t("invalidVideoTime");
                  const startSeconds = parseVideoTime(getValues("startTime"));
                  return (
                    startSeconds === null || endSeconds > startSeconds || t("videoEndAfterStart")
                  );
                },
              })}
            />
          </label>
          <div className="flex gap-2 md:col-span-2 md:justify-end xl:col-span-1">
            <Button
              disabled={addVideoM.isPending}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              {t("cancel")}
            </Button>
            <Button disabled={!formState.isValid || addVideoM.isPending} type="submit">
              <Icons.addVideo aria-hidden="true" />
              {t(addVideoM.isPending ? "addingVideo" : "addVideo")}
            </Button>
          </div>
        </div>
        {(formState.errors.url ||
          formState.errors.amount ||
          formState.errors.startTime ||
          formState.errors.endTime ||
          addVideoM.error) && (
          <div className="flex flex-col gap-1 text-xs text-destructive" role="alert">
            {formState.errors.url && <p>{formState.errors.url.message}</p>}
            {formState.errors.amount && <p>{formState.errors.amount.message}</p>}
            {formState.errors.startTime && <p>{formState.errors.startTime.message}</p>}
            {formState.errors.endTime && <p>{formState.errors.endTime.message}</p>}
            {addVideoM.error && <p>{t("videoCouldNotBeAdded")}</p>}
          </div>
        )}
        <div
          className="flex flex-col gap-0.5 text-[11px] leading-snug text-muted-foreground"
          id={timingHelpId}
        >
          <p>{t("manualVideoTimingHelp")}</p>
          {watchDuration !== null && <p>{t("watchDuration", { duration: watchDuration })}</p>}
          <p>{t("queueAmountHelp")}</p>
        </div>
      </form>
    </div>
  );
}
