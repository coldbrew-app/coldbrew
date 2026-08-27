import { defaultCurrencyChangeRate } from "@coldbrew/packages/currency.js";
import {
  MoneyAmountSchema,
  QueueCurrency,
  QueueCurrencySchema,
} from "@coldbrew/packages/schemas.js";
import { useUpdateQueueCurrencyM, useUserInfo } from "@web/hooks/api";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { useI18n } from "../lib/i18n";
import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type FormValues = {
  queueCurrency: QueueCurrency;
  rate: string;
};

function largerCurrency(left: QueueCurrency, right: QueueCurrency) {
  const order: Record<QueueCurrency, number> = { RUB: 1, USD: 90, EUR: 100 };
  return order[left] > order[right] ? left : right;
}

export function QueueCurrencyEditor() {
  const { t } = useI18n();
  const userInfo = useUserInfo();
  const updateQueueCurrencyM = useUpdateQueueCurrencyM();
  const [isEditing, setIsEditing] = useState(false);
  const { formState, handleSubmit, register, reset, setValue, watch } = useForm<FormValues>({
    defaultValues: { queueCurrency: userInfo.queueCurrency, rate: "1.00" },
    mode: "onChange",
  });
  const nextCurrency = watch("queueCurrency");
  const larger = largerCurrency(userInfo.queueCurrency, nextCurrency);
  const smaller = larger === userInfo.queueCurrency ? nextCurrency : userInfo.queueCurrency;

  useEffect(() => {
    setValue("rate", defaultCurrencyChangeRate(userInfo.queueCurrency, nextCurrency), {
      shouldValidate: true,
    });
  }, [nextCurrency, setValue, userInfo.queueCurrency]);

  const startEditing = () => {
    reset({
      queueCurrency: userInfo.queueCurrency,
      rate: defaultCurrencyChangeRate(userInfo.queueCurrency, userInfo.queueCurrency),
    });
    setIsEditing(true);
  };
  const cancelEditing = () => setIsEditing(false);
  const save = async (input: FormValues) => {
    await updateQueueCurrencyM.mutateAsync(input);
    setIsEditing(false);
  };

  return (
    <section className="cosmic-panel relative overflow-hidden p-4 sm:p-5">
      <span className="absolute top-0 left-6 h-1 w-16 rounded-b-full bg-[#54cfa5]" />
      {!isEditing ? (
        <div className="flex flex-wrap items-center gap-3">
          <QueueCurrencyHeading />
          <strong className="text-sm text-card-foreground">{userInfo.queueCurrency}</strong>
          <Button
            className="sm:ml-auto"
            onClick={startEditing}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("changeQueueCurrency")}
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(save)(event)}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <QueueCurrencyHeading />
            <Field className="w-auto" orientation="horizontal">
              <FieldLabel htmlFor="queue-currency">{t("queueCurrency")}</FieldLabel>
              <select
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                id="queue-currency"
                {...register("queueCurrency", {
                  setValueAs: (value) => QueueCurrencySchema.parse(value),
                })}
              >
                {(["RUB", "USD", "EUR"] as const).map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </Field>
            {nextCurrency !== userInfo.queueCurrency && (
              <Field
                className="w-auto"
                data-invalid={Boolean(formState.errors.rate)}
                orientation="horizontal"
              >
                <FieldLabel className="sr-only" htmlFor="queue-currency-rate">
                  {t("queueCurrencyRate", { larger, smaller })}
                </FieldLabel>
                <span>1 {larger} =</span>
                <Input
                  aria-describedby={formState.errors.rate ? "queue-currency-rate-error" : undefined}
                  aria-invalid={Boolean(formState.errors.rate)}
                  autoComplete="off"
                  className="h-9 w-24 bg-background"
                  id="queue-currency-rate"
                  min="0"
                  step="any"
                  type="number"
                  {...register("rate", {
                    validate: (value) => {
                      const $rate = MoneyAmountSchema.safeParse(value);
                      return ($rate.success && $rate.data !== "0.00") || t("enterExchangeRate");
                    },
                  })}
                />
                <span>{smaller}</span>
              </Field>
            )}
            <div className="flex gap-2 lg:ml-auto">
              <Button
                disabled={updateQueueCurrencyM.isPending}
                onClick={cancelEditing}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("cancelEditing")}
              </Button>
              <Button
                disabled={!formState.isValid || updateQueueCurrencyM.isPending}
                size="sm"
                type="submit"
              >
                {t(updateQueueCurrencyM.isPending ? "saving" : "save")}
              </Button>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("queueCurrencyWarning")}
          </p>
          <FieldError errors={[formState.errors.rate]} id="queue-currency-rate-error" />
          {updateQueueCurrencyM.error && (
            <FieldError>{updateQueueCurrencyM.error.message}</FieldError>
          )}
        </form>
      )}
    </section>
  );
}

function QueueCurrencyHeading() {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1.5">
      <h1 className="font-heading text-lg font-semibold text-card-foreground">
        {t("queueCurrency")}
      </h1>
      <Tooltip>
        <TooltipTrigger
          aria-label={t("queueCurrencyDescription")}
          className="grid size-5 cursor-pointer place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          type="button"
        >
          <Icons.help aria-hidden="true" size={14} />
        </TooltipTrigger>
        <TooltipContent>{t("queueCurrencyDescription")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
