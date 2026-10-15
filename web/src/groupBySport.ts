import type { EventWithOdds } from "./types";

export function groupBySport(events: EventWithOdds[]): Array<[string, EventWithOdds[]]> {
  const bySport = new Map<string, EventWithOdds[]>();
  for (const event of events) {
    const group = bySport.get(event.sport);
    if (group) group.push(event);
    else bySport.set(event.sport, [event]);
  }
  return Array.from(bySport.entries()).sort(([a], [b]) => a.localeCompare(b));
}
