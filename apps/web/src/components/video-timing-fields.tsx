import {
  getVideoTimeParts,
  getRoundedWatchDurationParts,
  getWatchDurationSeconds,
  parseVideoTime,
} from "@coldbrew/packages/video-timing.js";
import { cn } from "@web/lib/utils";
import { useId } from "react";
import { useFormContext } from "react-hook-form";

import { useI18n } from "../lib/i18n";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

export type VideoTimingValues = {
  endTime: string;
  startTime: string;
};

type ParsedVideoTiming = {
  endSeconds: number | null;
  startSeconds: number;
};

export function parseVideoTiming(
  { endTime, startTime }: VideoTimingValues,
  { allowOpenEnd }: { allowOpenEnd: boolean },
): ParsedVideoTiming | null {
  const startSeconds = parseVideoTime(startTime);
  const normalizedEndTime = endTime.trim();
  const endSeconds = normalizedEndTime === "" ? null : parseVideoTime(normalizedEndTime);

  if (startSeconds === null) {
    return null;
  }
  if (endSeconds === null) {
    return allowOpenEnd && normalizedEndTime === "" ? { startSeconds, endSeconds: null } : null;
  }
  if (endSeconds <= startSeconds) {
    return null;
  }

  return { startSeconds, endSeconds };
}

type Props = {
  allowOpenEnd?: boolean;
  className?: string;
  disabled?: boolean;
};

export function VideoTimingFields({ allowOpenEnd = false, className, disabled = false }: Props) {
  const { t } = useI18n();
  const { formState, getValues, register, trigger, watch } = useFormContext<VideoTimingValues>();
  const id = useId();
  const startId = `${id}-start`;
  const endId = `${id}-end`;
  const helpId = `${id}-help`;
  const startParsedId = `${id}-start-parsed`;
  const endParsedId = `${id}-end-parsed`;
  const startErrorId = `${id}-start-error`;
  const endErrorId = `${id}-end-error`;
  const startSeconds = parseVideoTime(watch("startTime"));
  const endSeconds = parseVideoTime(watch("endTime"));
  const watchDuration =
    startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
      ? getRoundedWatchDurationParts(getWatchDurationSeconds(startSeconds, endSeconds))
      : null;

  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <Field data-invalid={Boolean(formState.errors.startTime)}>
        <FieldLabel htmlFor={startId}>{t("videoStart")}</FieldLabel>
        <Input
          aria-describedby={`${startParsedId} ${helpId}${formState.errors.startTime ? ` ${startErrorId}` : ""}`}
          aria-invalid={Boolean(formState.errors.startTime)}
          autoComplete="off"
          disabled={disabled}
          id={startId}
          inputMode="numeric"
          placeholder="0:00"
          type="text"
          {...register("startTime", {
            onChange: () => void trigger("endTime"),
            required: t("enterVideoTime"),
            validate: (value) => parseVideoTime(value) !== null || t("invalidVideoTime"),
          })}
        />
        <FieldError errors={[formState.errors.startTime]} id={startErrorId} />
        <FieldDescription aria-live="polite" id={startParsedId}>
          {startSeconds !== null && t("parsedVideoTime", getVideoTimeParts(startSeconds))}
        </FieldDescription>
      </Field>
      <Field data-invalid={Boolean(formState.errors.endTime)}>
        <FieldLabel htmlFor={endId}>{t("videoEnd")}</FieldLabel>
        <Input
          aria-describedby={`${endParsedId} ${helpId}${formState.errors.endTime ? ` ${endErrorId}` : ""}`}
          aria-invalid={Boolean(formState.errors.endTime)}
          autoComplete="off"
          disabled={disabled}
          id={endId}
          inputMode="numeric"
          placeholder={allowOpenEnd ? t("videoEndPlaceholder") : "0:00"}
          type="text"
          {...register("endTime", {
            required: allowOpenEnd ? false : t("enterVideoTime"),
            validate: (value) => {
              if (value.trim() === "") {
                return allowOpenEnd || t("enterVideoTime");
              }
              const candidateEndSeconds = parseVideoTime(value);
              if (candidateEndSeconds === null) {
                return t("invalidVideoTime");
              }
              const candidateStartSeconds = parseVideoTime(getValues("startTime"));
              return (
                candidateStartSeconds === null ||
                candidateEndSeconds > candidateStartSeconds ||
                t("videoEndAfterStart")
              );
            },
          })}
        />
        <FieldError errors={[formState.errors.endTime]} id={endErrorId} />
        <FieldDescription aria-live="polite" id={endParsedId}>
          {endSeconds !== null && t("parsedVideoTime", getVideoTimeParts(endSeconds))}
        </FieldDescription>
      </Field>
      <FieldDescription className="col-span-2 flex flex-col gap-0.5" id={helpId}>
        {allowOpenEnd && <span>{t("manualVideoTimingHelp")}</span>}
        {watchDuration !== null ? (
          <span>{t("watchDuration", watchDuration)}</span>
        ) : (
          !allowOpenEnd && <span>{t("videoTimingHelp")}</span>
        )}
      </FieldDescription>
    </div>
  );
}
