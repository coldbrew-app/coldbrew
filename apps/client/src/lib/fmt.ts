const dateTime = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(date: Date) {
  return dateTime.format(date);
}

const amountFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

export function fmtAmount(amount: number) {
  if (isNaN(amount) || amount == Infinity || amount == -Infinity) {
    amount = 0;
  }
  return amountFormatter.format(amount);
}

export function fmtDuration(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeDate(date: Date) {
  const { round, abs } = Math;
  const minutes = round((date.getTime() - Date.now()) / 60_000);

  if (abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  if (abs(minutes) < 24 * 60) return relativeTime.format(round(minutes / 60), "hour");
  return relativeTime.format(round(minutes / (24 * 60)), "day");
}
