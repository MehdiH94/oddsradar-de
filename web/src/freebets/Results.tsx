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

const formatName = (legs: number) => (legs === 1 ? "Einzelwette" : `${legs}er-Kombiwette`);

// "Top-3-Umwandlungen", or "Top-Umwandlungen" when there are fewer.
const topTitle = (count: number) => (count === 3 ? "Top-3-Umwandlungen" : "Top-Umwandlungen");

function BookmakersResults({ answer, busy, selected, onSelect }: { answer: BookmakersAnswer; busy: boolean; selected: number; onSelect: (index: number) => void }) {
  const plan = answer.plans[Math.min(selected, answer.plans.length - 1)];
  return (
    <>
      <TopThree
        title={`${topTitle(answer.plans.length)} · ${formatName(answer.legs)}`}
        hint={`${answer.plans.length === 1 ? "Eine Möglichkeit" : `${answer.plans.length === 2 ? "Zwei" : "Drei"} Möglichkeiten`}, deine ${formatFb(answer.total)} FB umzuwandeln, mit verschiedenen Spielen. Wähl eine aus oder vergleiche sie.`}
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
      ? `Nur ein Spiel ist im Angebot, und die Liquidität der Wettbörse begrenzt es: ${formatFb(chain.leftover)} FB deines Guthabens bei ${name} bleiben nicht umgewandelt.`
      : `Eine einzige Umwandlung wandelt dein ganzes Guthaben bei ${name} um.`;
  }
  const chained = `Die Liquidität der Wettbörse begrenzt jede Umwandlung: Mach sie nacheinander, von Nr. 1 bis Nr. ${chain.steps.length}`;
  return rest ? `${chained}. ${formatFb(chain.leftover)} FB deines Guthabens bei ${name} bleiben nicht umgewandelt.` : `${chained}, um dein ganzes Guthaben bei ${name} umzuwandeln.`;
}

function ExchangeResults({ answer, busy, selected, onSelect }: { answer: ExchangeAnswer; busy: boolean; selected: number; onSelect: (index: number) => void }) {
  const chain = answer.chain!;
  const name = BOOKMAKER_BRANDING[answer.bookmaker]?.name ?? answer.bookmaker;
  const step = chain.steps[Math.min(selected, chain.steps.length - 1)];
  return (
    <>
      <TopThree
        title={`${topTitle(chain.steps.length)} · ${name} · ${formatFb(answer.fb)} FB`}
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
    return <EmptyState>Trag oben deine Freebets ein: Ein Buchmacher reicht, um sie gegen die Wettbörse umzuwandeln.</EmptyState>;
  }
  const fresh = conversions.answer !== null && sameRequest(conversions.answered, request);
  const answer = fresh ? conversions.answer : null;
  const busy = conversions.loading || waiting;
  const error = conversions.error;

  const banner = error && (
    <ErrorBanner onRetry={conversions.reload}>
      {answer ? `Die Umwandlungen konnten nicht aktualisiert werden: ${error}` : error}
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
        body = <EmptyState>Trag oben deine Freebets ein, um zu sehen, wie du sie umwandelst.</EmptyState>;
        break;
      case "single_bookmaker":
        body = (
          <EmptyState action={{ label: "Gegen die Wettbörse umwandeln", onClick: onSwitchToExchange }}>
            Deine Freebets liegen nur bei einem Buchmacher: Zum Umwandeln zwischen Buchmachern brauchst du mindestens zwei. Gegen die Wettbörse reicht einer.
          </EmptyState>
        );
        break;
      case "no_match":
        body = (
          <EmptyState>
            Mit diesen Einstellungen gibt es gerade kein Spiel zum Umwandeln. Wähle andere Sportarten oder schau später wieder vorbei: Die Buchmacher stellen ihre Spiele nach und nach online (die kommende Woche wird berücksichtigt).
          </EmptyState>
        );
        break;
      case "no_plan":
        body = <EmptyState>Mit diesen Spielen und deinen Freebets ist keine garantierte Umwandlung möglich. Probier ein anderes Format oder andere Sportarten.</EmptyState>;
        break;
      default:
        body = (
          <>
            {answer.partial && <p className={styles.note}>Die Zeit für die Berechnung war zu knapp: Es gibt vielleicht bessere Umwandlungen.</p>}
            <BookmakersResults answer={answer} busy={busy} selected={selected} onSelect={(index) => setChoice({ key: requestKey, index })} />
          </>
        );
    }
  } else {
    switch (answer.reason) {
      case "no_freebets":
        body = <EmptyState>Du hast keine Freebets bei diesem Buchmacher.</EmptyState>;
        break;
      case "no_match":
        body = <EmptyState>Mit diesen Einstellungen hat gerade kein Spiel dieses Buchmachers Geld für einen Lay an der Wettbörse. Wähle andere Sportarten oder schau später wieder vorbei.</EmptyState>;
        break;
      case "no_plan":
        body = <EmptyState>Mit diesen Spielen ist keine garantierte Umwandlung gegen die Wettbörse möglich.</EmptyState>;
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
