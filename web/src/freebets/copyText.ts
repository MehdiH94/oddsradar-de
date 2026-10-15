import { BOOKMAKER_BRANDING } from "../bookmakers";
import { formatFb } from "./format";
import type { PlanView } from "./freebetsApi";

type Group = PlanView["bookmakers"][number];

// The list to paste where the bets are placed: one line per bet.
export function copyText(group: Group): string {
  const name = BOOKMAKER_BRANDING[group.bookmaker]?.name ?? group.bookmaker;
  return [`${name}: ${group.bets.length} freebet bet${group.bets.length === 1 ? "" : "s"}`, ...group.bets.map((bet) => `- ${bet.label}: ${formatFb(bet.stake)} FB`)].join("\n");
}

