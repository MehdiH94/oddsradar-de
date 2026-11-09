import type { AdminOddsApiCredits } from "./adminApi";

const CHECKED_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });
const RENEW_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeZone: "UTC" });

// "15 min", "16 h 40 min".
const readEvery = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`);

// The Odds API's credits left as the "Bookmakers" tab says them, and whether
// they are spent (at or under the floor: Tipico's, Winamax's and Pinnacle's
// prices stop until they renew). Nothing before the worker has read it.
export function oddsApiCreditsLabel(credits: AdminOddsApiCredits | null): { text: string; spent: boolean } | null {
  if (!credits) return null;
  if (credits.creditsLeft === null) return { text: "credits left not told yet", spent: false };
  const checked = credits.checkedAt ? ` (checked ${CHECKED_FORMAT.format(new Date(credits.checkedAt))})` : "";
  const spent = credits.creditsLeft <= credits.floor;
  const pace = !spent && typeof credits.refreshMinutes === "number" ? `, a read every ${readEvery(credits.refreshMinutes)}` : "";
  const renews = credits.renewsAt
    ? `; renews on ${RENEW_FORMAT.format(new Date(credits.renewsAt))}${typeof credits.readsLeft === "number" && !spent ? `, about ${credits.readsLeft} reads left` : ""}`
    : "";
  return {
    text: `${credits.creditsLeft} credits left this month${checked}${pace}${spent ? `: at the floor of ${credits.floor}, no reads until they renew` : ""}${renews}`,
    spent,
  };
}
