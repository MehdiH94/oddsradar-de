// German number and date formats: "1,65", "95,8 %", "Morgen 21:00", the
// hours on 24 h. The space before "%" is a no-break one, so that a percentage
// never wraps away from its sign.

const PERCENT_SIGN = " %";

// A decimal comma, and no thousands separator: a price of 1001 reads "1001,00".
function decimal(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

export function formatPrice(price: number): string {
  return decimal(price, 2);
}

// A price's edge over the fair odds: "+2,1 %".
export function formatEdge(edge: number): string {
  return `${edge >= 0 ? "+" : "−"}${decimal(Math.abs(edge * 100), 1)}${PERCENT_SIGN}`;
}

// A threshold: "5 %".
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}${PERCENT_SIGN}`;
}

export function formatPayoutRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "-" : `${decimal(rate * 100, 1)}${PERCENT_SIGN}`;
}

const START_TIME_FORMAT = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const HOUR_FORMAT = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const LONG_DAY_FORMAT = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });

// Calendar days in the viewer's time zone, not UTC: a 00:30 kick-off is
// "tomorrow" at 23:30 the evening before.
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function relativeDay(date: Date, now: Date): "today" | "tomorrow" | null {
  if (isSameDay(date, now)) return "today";
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameDay(date, tomorrow) ? "tomorrow" : null;
}

// Today's matches show their hour only, tomorrow's "Morgen" and the hour, the
// others their full date ("So., 04.10., 21:00"): the closest ones are read at a
// glance.
export function formatStartTime(startTime: string, now = new Date()): string {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return "-";
  const day = relativeDay(date, now);
  if (day === "today") return HOUR_FORMAT.format(date);
  if (day === "tomorrow") return `Morgen ${HOUR_FORMAT.format(date)}`;
  return START_TIME_FORMAT.format(date);
}

// The same, split for a two-line cell: the hour, and its day
// ("Heute", "Morgen", "Mo., 21.09."). Null for an unreadable date.
export function formatStartParts(startTime: string, now = new Date()): { time: string; day: string } | null {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  const day = relativeDay(date, now);
  return {
    time: HOUR_FORMAT.format(date),
    day: day === "today" ? "Heute" : day === "tomorrow" ? "Morgen" : SHORT_DAY_FORMAT.format(date),
  };
}

// The heading of a day's matches when sorted by kick-off: "Heute",
// "Morgen", "Samstag, 4. Oktober". `key` tells two days apart.
export function dayHeading(startTime: string, now = new Date()): { key: string; label: string } | null {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const day = relativeDay(date, now);
  const label = day === "today" ? "Heute" : day === "tomorrow" ? "Morgen" : LONG_DAY_FORMAT.format(date);
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

// How long ago a price was read: "gerade eben", "vor 4 Min.", "vor 2 Std."
// (a surebet's legs, a value bet's price).
export function readAgo(readAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(readAt)) / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes}\u00a0Min.`;
  return `vor ${Math.floor(minutes / 60)}\u00a0Std.`;
}
