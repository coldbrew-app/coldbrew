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
  if (userInfo === null) throw new Error("Authenticated user info is required.");
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
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm shadow-primary/5 sm:p-5">
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
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <span>{t("queueCurrency")}</span>
              <select
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
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
            </label>
            {nextCurrency !== userInfo.queueCurrency && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="sr-only">{t("queueCurrencyRate", { larger, smaller })}</span>
                <span>1 {larger} =</span>
                <input
                  aria-invalid={Boolean(formState.errors.rate)}
                  autoComplete="off"
                  className="h-9 w-24 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
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
              </label>
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
          {(formState.errors.rate || updateQueueCurrencyM.error) && (
            <p className="text-xs text-red-600" role="alert">
              {formState.errors.rate?.message ?? updateQueueCurrencyM.error?.message}
            </p>
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
