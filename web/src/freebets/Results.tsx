import { useState } from "react";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { EmptyState, ErrorBanner, Skeleton } from "../components/StatusViews";
import { exchangeCards, planCards } from "./cards";
import { ChainBar, StepDetail } from "./ExchangeView";
import { formatFb } from "./format";
import type { BookmakersAnswer, ConversionRequest, ExchangeAnswer } from "./freebetsApi";
import { OddsNotice } from "./OddsNotice";
import { PlanDetail } from "./PlanDetail";
import { Placement } from "./Placement";
import { TopThree } from "./TopThree";
import type { Conversions } from "./useConversions";
import styles from "./Results.module.css";

const sameRequest = (a: ConversionRequest | null, b: ConversionRequest | null) => JSON.stringify(a) === JSON.stringify(b);

const formatName = (legs: number) => (legs === 1 ? "single bet" : `${legs}-match accumulator`);

function BookmakersResults({ answer, busy, selected, onSelect }: { answer: BookmakersAnswer; busy: boolean; selected: number; onSelect: (index: number) => void }) {
  const plan = answer.plans[Math.min(selected, answer.plans.length - 1)];
  return (
    <>
      <TopThree
        title={`Top ${answer.plans.length === 3 ? "3 " : ""}conversions · ${formatName(answer.legs)}`}
        hint={`${answer.plans.length === 1 ? "One way" : `${answer.plans.length === 2 ? "Two" : "Three"} ways`} to convert your ${formatFb(answer.total)} FB, on different matches. Pick one, or compare them.`}
        cards={planCards(answer)}
        selected={selected}
        onSelect={onSelect}
        busy={busy}
      />
      <PlanDetail plan={plan} total={answer.total} legs={answer.legs} />
      <Placement plan={plan} />
      <OddsNotice mode="bookmakers" />
    </>
  );
}

// What the chain asks of the account: the exchange's liquidity limits each conversion, so there are several to
// chain, and a balance too big for all of them leaves some freebets unconverted.
function chainHint(chain: ExchangeAnswer["chain"] & object, name: string): string {
  const rest = chain.leftover > 0.005;
  if (chain.steps.length === 1) {
    return rest
      ? `Only one match is on offer and the exchange's liquidity limits it: ${formatFb(chain.leftover)} FB of your ${name} balance will stay unconverted.`
      : `A single conversion converts all of your ${name} balance.`;
  }
  const chained = `The exchange's liquidity limits each conversion: chain them, from no. 1 to no. ${chain.steps.length}`;
  return rest ? `${chained}. ${formatFb(chain.leftover)} FB of your ${name} balance will stay unconverted.` : `${chained}, to convert all of your ${name} balance.`;
}

function ExchangeResults({ answer, busy, selected, onSelect }: { answer: ExchangeAnswer; busy: boolean; selected: number; onSelect: (index: number) => void }) {
  const chain = answer.chain!;
  const name = BOOKMAKER_BRANDING[answer.bookmaker]?.name ?? answer.bookmaker;
  const step = chain.steps[Math.min(selected, chain.steps.length - 1)];
  return (
    <>
      <TopThree
        title={`Top ${chain.steps.length === 3 ? "3 " : ""}conversions · ${name} · ${formatFb(answer.fb)} FB`}
        hint={chainHint(chain, name)}
        cards={exchangeCards(chain, answer.fb)}
        selected={selected}
        onSelect={onSelect}
        busy={busy}
      />
      <ChainBar chain={chain} bookmaker={answer.bookmaker} fb={answer.fb} />
      <StepDetail chain={chain} step={step} bookmaker={answer.bookmaker} fb={answer.fb} commission={answer.commission} />
      <OddsNotice mode="exchange" />
    </>
  );
}

// What the page shows under the settings: the three best conversions and the detail of the chosen one, or why there
// are none. The last answer stays on screen (dimmed) while a new one is on its way, as long as it answers the same settings.
export function Results({
  request,
  conversions,
  walletReady,
  waiting,
  onSwitchToExchange,
}: {
  request: ConversionRequest | null;
  conversions: Conversions;
  walletReady: boolean;
  // The wallet is being saved: what is shown may not be about it yet.
  waiting: boolean;
  onSwitchToExchange: () => void;
}) {
  const requestKey = JSON.stringify(request);
  // The plan chosen, forgotten when the settings change.
  const [choice, setChoice] = useState<{ key: string; index: number }>({ key: requestKey, index: 0 });
  const selected = choice.key === requestKey ? choice.index : 0;

  if (!walletReady) return null;
  if (!request) {
    return <EmptyState>Enter your freebets above: one bookmaker is enough to convert them against the exchange.</EmptyState>;
  }
  const fresh = conversions.answer !== null && sameRequest(conversions.answered, request);
  const answer = fresh ? conversions.answer : null;
  const busy = conversions.loading || waiting;
  const error = conversions.error;

  const banner = error && (
    <ErrorBanner onRetry={conversions.reload}>
      {answer ? `The conversions could not be refreshed: ${error}` : error}
    </ErrorBanner>
  );
  if (!answer) {
    return (
      <>
        {banner}
        {!error && <Skeleton rows={4} />}
      </>
    );
  }

  let body;
  if (answer.mode === "bookmakers") {
    switch (answer.reason) {
      case "empty_wallet":
        body = <EmptyState>Enter your freebets above to see how to convert them.</EmptyState>;
        break;
      case "single_bookmaker":
        body = (
          <EmptyState action={{ label: "Convert against the exchange", onClick: onSwitchToExchange }}>
            Your freebets are at one bookmaker only: converting between bookmakers takes at least two. Against the exchange, one is enough.
          </EmptyState>
        );
        break;
      case "no_match":
        body = (
          <EmptyState>
            No match to convert with these settings for now. Tick other sports, or come back later: bookmakers put their matches online day by day (the coming week is taken into account).
          </EmptyState>
        );
        break;
      case "no_plan":
        body = <EmptyState>No guaranteed conversion is possible with these matches and your freebets. Try another format or other sports.</EmptyState>;
        break;
      default:
        body = (
          <>
            {answer.partial && <p className={styles.note}>The calculation ran out of time: better conversions may exist.</p>}
            <BookmakersResults answer={answer} busy={busy} selected={selected} onSelect={(index) => setChoice({ key: requestKey, index })} />
          </>
        );
    }
  } else {
    switch (answer.reason) {
      case "no_freebets":
        body = <EmptyState>You have no freebets at this bookmaker.</EmptyState>;
        break;
      case "no_match":
        body = <EmptyState>No match of this bookmaker has money to lay on the exchange with these settings for now. Tick other sports or come back later.</EmptyState>;
        break;
      case "no_plan":
        body = <EmptyState>No guaranteed conversion is possible against the exchange with these matches.</EmptyState>;
        break;
      default:
        body = <ExchangeResults answer={answer} busy={busy} selected={selected} onSelect={(index) => setChoice({ key: requestKey, index })} />;
    }
  }
  return (
    <div className={busy ? styles.busy : styles.results} aria-busy={busy}>
      {banner}
      {body}
    </div>
  );
}
