import { MoneyAmountSchema } from "./schemas.js";
import type { CurrencyCode, Money, MoneyAmount, QueueCurrency } from "./schemas.js";

export const queueCurrencies = ["RUB", "USD", "EUR"] as const;

const rublesPerUnit: Record<QueueCurrency, bigint> = {
  RUB: 1n,
  USD: 90n,
  EUR: 100n,
};

function cents(amount: MoneyAmount) {
  const [whole = "0", fraction = "0"] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

function moneyAmount(value: bigint): MoneyAmount {
  return MoneyAmountSchema.parse(`${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`);
}

function roundDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / 2n) / denominator;
}

export function isQueueCurrency(currency: CurrencyCode) {
  return queueCurrencies.includes(currency as QueueCurrency);
}

export function convertWithDefaultRate(money: Money, currency: QueueCurrency) {
  if (!isQueueCurrency(money.currency)) return null;
  const sourceCurrency = money.currency as QueueCurrency;

  return {
    money: {
      amount: moneyAmount(
        roundDiv(cents(money.amount) * rublesPerUnit[sourceCurrency], rublesPerUnit[currency]),
      ),
      currency,
    },
    rate: `${rublesPerUnit[sourceCurrency]}/${rublesPerUnit[currency]}`,
  };
}

export function conversionFactorForCurrencyChange(
  from: QueueCurrency,
  to: QueueCurrency,
  rate: MoneyAmount,
) {
  const fromIsLarger = rublesPerUnit[from] > rublesPerUnit[to];
  const numerator = fromIsLarger ? cents(rate) : 100n;
  const denominator = fromIsLarger ? 100n : cents(rate);
  return { numerator, denominator };
}

export function defaultCurrencyChangeRate(from: QueueCurrency, to: QueueCurrency) {
  const larger = rublesPerUnit[from] > rublesPerUnit[to] ? from : to;
  const smaller = larger === from ? to : from;
  return moneyAmount(roundDiv(rublesPerUnit[larger], rublesPerUnit[smaller]) * 100n);
}
