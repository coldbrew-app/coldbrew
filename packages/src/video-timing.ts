export function getWatchDurationSeconds(startSeconds: number, endSeconds: number) {
  return endSeconds - startSeconds;
}

export function getRoundedWatchDurationMinutes(totalSeconds: number) {
  return Math.round(totalSeconds / 60);
}

export function getRoundedWatchDurationParts(totalSeconds: number) {
  const totalMinutes = getRoundedWatchDurationMinutes(totalSeconds);

  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

export function getVideoTimeParts(totalSeconds: number) {
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function formatVideoTime(totalSeconds: number) {
  const { hours, minutes, seconds } = getVideoTimeParts(totalSeconds);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function parseVideoTime(value: string) {
  const match = value.trim().match(/^(?:(\d+):([0-5]\d):([0-5]\d)|(\d+):([0-5]\d))$/);
  if (match === null) return null;

  const [, hours = "0", hourMinutes, hourSeconds, minutes = "0", minuteSeconds] = match;
  const totalSeconds =
    Number(hours) * 3600 +
    Number(hourMinutes ?? minutes) * 60 +
    Number(hourSeconds ?? minuteSeconds);

  return Number.isSafeInteger(totalSeconds) ? totalSeconds : null;
}
