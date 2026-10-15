// French number and date formats: "1,65", "95,8 %", "Demain 21:00", like the
// bookmakers' own sites. A non-breaking space keeps "95,8" and "%" together.
const NBSP = " ";

export function formatPrice(price: number): string {
  return price.toFixed(2).replace(".", ",");
}

// A price's edge over the fair odds: "+2,1 %".
export function formatEdge(edge: number): string {
  return `${edge >= 0 ? "+" : "−"}${Math.abs(edge * 100).toFixed(1).replace(".", ",")}${NBSP}%`;
}

// A threshold: "5 %".
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}${NBSP}%`;
}

export function formatPayoutRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "-" : `${(rate * 100).toFixed(1).replace(".", ",")}${NBSP}%`;
}

const START_TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const HOUR_FORMAT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
const LONG_DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

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

// Today's matches show their hour only, tomorrow's "Demain" and the hour, the
// others their full date: the closest ones are read at a glance.
export function formatStartTime(startTime: string, now = new Date()): string {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return "-";
  const day = relativeDay(date, now);
  if (day === "today") return HOUR_FORMAT.format(date);
  if (day === "tomorrow") return `Demain ${HOUR_FORMAT.format(date)}`;
  return START_TIME_FORMAT.format(date);
}

// The same, split for a two-line cell: the hour, and its day
// ("Aujourd'hui", "Demain", "lun. 21/09"). Null for an unreadable date.
export function formatStartParts(startTime: string, now = new Date()): { time: string; day: string } | null {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  const day = relativeDay(date, now);
  return {
    time: HOUR_FORMAT.format(date),
    day: day === "today" ? "Aujourd'hui" : day === "tomorrow" ? "Demain" : SHORT_DAY_FORMAT.format(date),
  };
}

// The heading of a day's matches when sorted by kick-off: "Aujourd'hui",
// "Demain", "samedi 4 octobre". `key` tells two days apart.
export function dayHeading(startTime: string, now = new Date()): { key: string; label: string } | null {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const day = relativeDay(date, now);
  const label = day === "today" ? "Aujourd'hui" : day === "tomorrow" ? "Demain" : LONG_DAY_FORMAT.format(date);
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1) };
}
