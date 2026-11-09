// "next read in about 9 h": when a paused bookmaker's next paced read is due
// (the same as the server's, src/db/bookmakerStatus.ts, nextReadLabel).
export function nextReadLabel(nextReadAt: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(nextReadAt) - now) / 60_000);
  if (minutes <= 0) return "next read due now";
  return minutes < 90 ? `next read in about ${minutes} min` : `next read in about ${Math.round(minutes / 60)} h`;
}
