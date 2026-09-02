import { MoneyAmountSchema } from "@coldbrew/packages/schemas.js";
import { youtubeVideoId } from "@coldbrew/packages/youtube.js";
import { useAddVideoM, useUserInfoSafe } from "@web/hooks/api";
import { formatMoneyInputValue } from "@web/lib/fmt";
import { useI18n } from "@web/lib/i18n";
import { FormProvider, useForm } from "react-hook-form";

import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { parseVideoTiming, VideoTimingFields, type VideoTimingValues } from "./video-timing-fields";

type Props = {
  onCancel: () => void;
};

type AddVideoFormValues = VideoTimingValues & {
  url: string;
  amount: string;
};

export function AddVideoForm({ onCancel }: Props) {
  const { t } = useI18n();
  const userInfo = useUserInfoSafe();
  const addVideoM = useAddVideoM();
  const urlErrorId = "manual-video-url-error";
  const amountHelpId = "manual-video-amount-help";
  const amountErrorId = "manual-video-amount-error";
  const form = useForm<AddVideoFormValues>({
    defaultValues: {
      url: "",
      amount: formatMoneyInputValue(MoneyAmountSchema.parse("0.00")),
      startTime: "0:00",
      endTime: "",
    },
    mode: "onChange",
  });
  const { formState, handleSubmit, register, reset } = form;

  const addVideo = async ({ url, amount, startTime, endTime }: AddVideoFormValues) => {
    const timing = parseVideoTiming({ startTime, endTime }, { allowOpenEnd: true });
    if (timing === null) {
      return;
    }

    try {
      await addVideoM.mutateAsync({ url: url.trim(), amount, ...timing });
      reset();
      onCancel();
    } catch {
      // The mutation error is rendered below the form.
    }
  };

  return (
    <div className="border-b border-border bg-secondary/35 p-4 sm:px-5" id="add-video-form">
      <FormProvider {...form}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => void handleSubmit(addVideo)(event)}
        >
          <div className="grid gap-3 md:grid-cols-2 md:items-end xl:grid-cols-[minmax(0,1fr)_11rem_16rem_auto]">
            <Field className="min-w-0" data-invalid={Boolean(formState.errors.url)}>
              <FieldLabel htmlFor="manual-video-url">{t("manualVideoUrl")}</FieldLabel>
              <Input
                aria-describedby={formState.errors.url ? urlErrorId : undefined}
                aria-invalid={Boolean(formState.errors.url)}
                disabled={addVideoM.isPending}
                id="manual-video-url"
                placeholder="https://youtu.be/…"
                type="url"
                {...register("url", {
                  required: t("enterYoutubeUrl"),
                  validate: (url) => youtubeVideoId(url.trim()) !== null || t("invalidYoutubeUrl"),
                })}
              />
              <FieldError errors={[formState.errors.url]} id={urlErrorId} />
            </Field>
            <Field data-invalid={Boolean(formState.errors.amount)}>
              <FieldLabel htmlFor="manual-video-amount">{t("amount")}</FieldLabel>
              <div className="flex rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-[input[aria-invalid=true]]:border-destructive">
                <Input
                  aria-describedby={`${amountHelpId}${formState.errors.amount ? ` ${amountErrorId}` : ""}`}
                  aria-invalid={Boolean(formState.errors.amount)}
                  className="min-w-0 grow rounded-none border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent"
                  disabled={addVideoM.isPending}
                  id="manual-video-amount"
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
              <FieldDescription id={amountHelpId}>{t("queueAmountHelp")}</FieldDescription>
              <FieldError errors={[formState.errors.amount]} id={amountErrorId} />
            </Field>
            <VideoTimingFields
              allowOpenEnd
              className="md:col-span-2 xl:col-span-1"
              disabled={addVideoM.isPending}
            />
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
          {addVideoM.error && <FieldError>{t("videoCouldNotBeAdded")}</FieldError>}
        </form>
      </FormProvider>
    </div>
  );
}
