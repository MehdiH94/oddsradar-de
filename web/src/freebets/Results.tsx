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

const formatName = (legs: number) => (legs === 1 ? "pari simple" : `combiné ${legs} matchs`);

function BookmakersResults({ answer, busy, selected, onSelect }: { answer: BookmakersAnswer; busy: boolean; selected: number; onSelect: (index: number) => void }) {
  const plan = answer.plans[Math.min(selected, answer.plans.length - 1)];
  return (
    <>
      <TopThree
        title={`Top ${answer.plans.length === 3 ? "3 " : ""}des conversions · ${formatName(answer.legs)}`}
        hint={`${answer.plans.length === 1 ? "Une façon" : `${answer.plans.length === 2 ? "Deux" : "Trois"} façons`} de convertir vos ${formatFb(answer.total)} FB, sur des matchs différents. Choisissez-en une, ou comparez-les.`}
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
      ? `Un seul match est proposé et la liquidité de l'exchange le limite : ${formatFb(chain.leftover)} FB de votre solde ${name} resteront non convertis.`
      : `Une seule conversion suffit à convertir tout votre solde ${name}.`;
  }
  const chained = `La liquidité de l'exchange limite chaque conversion : enchaînez-les, du n°1 au n°${chain.steps.length}`;
  return rest ? `${chained}. ${formatFb(chain.leftover)} FB de votre solde ${name} resteront non convertis.` : `${chained}, pour convertir tout votre solde ${name}.`;
}

function ExchangeResults({ answer, busy, selected, onSelect }: { answer: ExchangeAnswer; busy: boolean; selected: number; onSelect: (index: number) => void }) {
  const chain = answer.chain!;
  const name = BOOKMAKER_BRANDING[answer.bookmaker]?.name ?? answer.bookmaker;
  const step = chain.steps[Math.min(selected, chain.steps.length - 1)];
  return (
    <>
      <TopThree
        title={`Top ${chain.steps.length === 3 ? "3 " : ""}des conversions · ${name} · ${formatFb(answer.fb)} FB`}
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
    return <EmptyState>Indiquez vos freebets ci-dessus : un seul bookmaker suffit pour les convertir contre l'exchange.</EmptyState>;
  }
  const fresh = conversions.answer !== null && sameRequest(conversions.answered, request);
  const answer = fresh ? conversions.answer : null;
  const busy = conversions.loading || waiting;
  const error = conversions.error;

  const banner = error && (
    <ErrorBanner onRetry={conversions.reload}>
      {answer ? `Impossible d'actualiser les conversions : ${error}` : error}
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
        body = <EmptyState>Indiquez vos freebets ci-dessus pour voir comment les convertir.</EmptyState>;
        break;
      case "single_bookmaker":
        body = (
          <EmptyState action={{ label: "Convertir contre l'exchange", onClick: onSwitchToExchange }}>
            Vos freebets sont chez un seul bookmaker : il en faut au moins deux pour les convertir entre bookmakers. Contre l'exchange, un seul suffit.
          </EmptyState>
        );
        break;
      case "no_match":
        body = (
          <EmptyState>
            Aucun match à convertir avec ces réglages pour le moment. Cochez d'autres sports, ou revenez plus tard : les bookmakers mettent leurs matchs en ligne au fil des jours (la semaine à venir est prise en compte).
          </EmptyState>
        );
        break;
      case "no_plan":
        body = <EmptyState>Aucune conversion garantie n'est possible avec ces matchs et vos freebets. Essayez un autre format ou d'autres sports.</EmptyState>;
        break;
      default:
        body = (
          <>
            {answer.partial && <p className={styles.note}>Le calcul a été interrompu faute de temps : il existe peut-être de meilleures conversions.</p>}
            <BookmakersResults answer={answer} busy={busy} selected={selected} onSelect={(index) => setChoice({ key: requestKey, index })} />
          </>
        );
    }
  } else {
    switch (answer.reason) {
      case "no_freebets":
        body = <EmptyState>Vous n'avez pas de freebets chez ce bookmaker.</EmptyState>;
        break;
      case "no_match":
        body = <EmptyState>Aucun match de ce bookmaker n'a, pour le moment, d'argent à layer sur l'exchange avec ces réglages. Cochez d'autres sports ou revenez plus tard.</EmptyState>;
        break;
      case "no_plan":
        body = <EmptyState>Aucune conversion garantie n'est possible contre l'exchange avec ces matchs.</EmptyState>;
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
