import { formatStartTime } from "../format";
import { formatEuro, formatFb, formatRate } from "./format";
import type { BookmakersAnswer, ChainView } from "./freebetsApi";
import type { TopCard } from "./TopThree";

// The FB left once the steps before the `index`th are done.
export const before = (chain: ChainView, index: number, fb: number) => Math.round((fb - chain.steps.slice(0, index).reduce((sum, s) => sum + s.fb, 0)) * 100) / 100;

// The three conversions as the cards of the top: each one's share of the wallet is drawn after the ones before it.
export function exchangeCards(chain: ChainView, fb: number): TopCard[] {
  return chain.steps.map((step, i) => {
    const left = before(chain, i, fb);
    return {
      key: step.eventId + step.selection,
      rank: step.rank,
      badge: step.limited ? { text: "Durch Liquidität begrenzt", tone: "warning" } : { text: "Wandelt den ganzen Rest um", tone: "good" },
      rate: formatRate(step.rate),
      cash: formatEuro(step.cash),
      from: (fb - left) / fb,
      to: (fb - left + step.fb) / fb,
      caption: (
        <>
          Wandelt <b className="num">{formatFb(step.fb)}</b> FB um · danach <span className="num">{formatFb(Math.round((left - step.fb) * 100) / 100)}</span> FB übrig
        </>
      ),
      lines: [step.label, `${step.participants.join(" – ")} · ${formatStartTime(step.startTime)}`],
    };
  });
}


// The card of each plan between bookmakers: the best rate is told apart by a word, since the plans are ranked by the cash.
export function planCards(answer: BookmakersAnswer): TopCard[] {
  const best = Math.max(...answer.plans.map((plan) => plan.rate));
  const unique = answer.plans.filter((plan) => plan.rate === best).length === 1;
  return answer.plans.map((plan) => ({
    key: plan.matches.map((m) => m.eventId).join("+"),
    rank: plan.rank,
    badge: answer.plans.length > 1 && unique && plan.rate === best ? { text: "Beste Rate", tone: "good" } : undefined,
    rate: formatRate(plan.rate),
    cash: formatEuro(plan.cash),
    to: answer.total > 0 ? plan.used / answer.total : 0,
    caption: (
      <>
        <b className="num">{formatFb(plan.used)}</b> FB von <span className="num">{formatFb(answer.total)}</span> umgewandelt
      </>
    ),
    lines: plan.matches.map((match) => match.participants.join(" – ")),
  }));
}
