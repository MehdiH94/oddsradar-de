import type { ReactNode } from "react";
import { ArrowLeftRight, ChevronDown, Gem, Gift, Layers, ListOrdered, Scale } from "lucide-react";
import { ALL_BOOKMAKERS, ALL_BOOKMAKERS_SENTENCE, BOOKMAKER_BRANDING } from "./bookmakers";
import { BookmakerLogo } from "./BookmakerLogo";
import { APP_NAME } from "./brand";
import { formatPercent } from "./format";
import { FREEBETS_PATH, oddsHref, valueBetsHref } from "./routes";
import { sportEmoji, sportLabel } from "./sports";
import { PLAYER_VALUE_MIN_EDGE, REFERENCE_SOURCE, VALUE_MIN_EDGE } from "./value";
import { useHomeStats } from "./useHomeStats";
import { AppFooter } from "./components/AppFooter";
import { GamblingBanner } from "./components/GamblingBanner";
import { HomeHeader } from "./components/HomeHeader";
import { LivePreview, LiveStats } from "./components/HomeLive";
import { Link } from "./components/Link";
import { Logo } from "./components/Logo";
import styles from "./HomePage.module.css";

const bookmakerName = (id: string) => BOOKMAKER_BRANDING[id]?.name ?? id;
const BOOKMAKER_COUNT = ALL_BOOKMAKERS.length;

const FEATURES: ReadonlyArray<{ title: string; Icon: typeof Gem; text: ReactNode }> = [
  {
    title: "Compare without going from site to site",
    Icon: ListOrdered,
    text: (
      <>
        For each match, the price of each of the {BOOKMAKER_COUNT} bookmakers side by side. The best price of each outcome
        is green and ticked. The payout sums up the bookmakers' margin: the closer it is to 100%, the less they take.
      </>
    ),
  },
  {
    title: "Spot the value bets",
    Icon: Gem,
    text: (
      <>
        A price is a value bet when it is at least {formatPercent(VALUE_MIN_EDGE)} above the fair odds: the Betfair
        exchange's price, without its margin. The edge is shown, so you know where to look first.
      </>
    ),
  },
  {
    title: "Get to the bottom of a match",
    Icon: Layers,
    text: (
      <>
        For the next 48 hours of football, tennis and basketball, the match's markets (scorers, totals, handicaps…) are
        compared from one bookmaker to the other. When a market's best prices add up to a payout over 100%, it is flagged
        as a surebet.
      </>
    ),
  },
];

const STEPS: ReadonlyArray<{ title: string; text: ReactNode }> = [
  {
    title: "We read the odds",
    text: `Every few minutes, we read the pre-match odds of ${ALL_BOOKMAKERS_SENTENCE}.`,
  },
  {
    title: "We weigh them against the fair odds",
    text: "They come from the Betfair exchange, where bettors set the prices themselves, once its margin is taken out.",
  },
  {
    title: "You see the edge",
    text: "A price above the fair odds is framed, with its edge: “+2.1%” means it pays 2.1% more.",
  },
];

// The freebets' conversions, said in two ways: what each one asks of the account (the exchange's lay is advanced).
const FREEBET_WAYS: ReadonlyArray<{ title: string; Icon: typeof Gem; text: ReactNode }> = [
  {
    title: "Between bookmakers",
    Icon: ArrowLeftRight,
    text: "Your freebets at several bookmakers, spread over a single bet or an accumulator of 2 or 3 matches, so as to collect the same amount whatever the result. No real money staked.",
  },
  {
    title: "Against the exchange",
    Icon: Scale,
    text: "A bookmaker's freebets back an outcome, and the same outcome is laid on the exchange: the profit is guaranteed, within the money available on the exchange. The lay's liability is advanced, then returned after the match.",
  },
];

const FAQ: ReadonlyArray<{ question: string; answer: ReactNode }> = [
  {
    question: "What is a value bet?",
    answer: (
      <>
        A bet whose price is higher than what the outcome's chances are really worth. {APP_NAME} estimates that worth with
        the fair odds of {REFERENCE_SOURCE} and flags any price at least {formatPercent(VALUE_MIN_EDGE)} above them (
        {formatPercent(PLAYER_VALUE_MIN_EDGE)} on player markets). It is a pointer, not a certainty: a bet above the fair
        odds can lose.
      </>
    ),
  },
  {
    question: "Where do the fair odds come from?",
    answer: (
      <>
        They are the price at {REFERENCE_SOURCE} once its margin is taken out. On an exchange, bettors set the prices: it
        is the reference closest to the true probabilities. When the exchange has too little money on an outcome,{" "}
        {APP_NAME} shows no fair odds.
      </>
    ),
  },
  {
    question: "What is a surebet?",
    answer: (
      <>
        A market whose best prices, put together, would guarantee a profit whatever happens (a payout over 100%). {APP_NAME}{" "}
        lists them at the top of the value bets. But the rules of the same market can differ from one bookmaker to another
        and a price can change before you bet: always check.
      </>
    ),
  },
  {
    question: "What is a freebet, and how do you turn it into cash?",
    answer: (
      <>
        A freebet is a stake a bookmaker gives you: if it wins, you collect the winnings, but the stake is not returned. In
        the Freebets tab, {APP_NAME} works out how to spread it to collect the same amount whatever the result: between
        several bookmakers, or by backing the outcome at a bookmaker and laying it on the exchange. You get a share of the
        freebet's value, never all of it, which depends on the current prices: check them before placing your bets.
      </>
    ),
  },
  {
    question: `Do I need an account? Can I bet on ${APP_NAME}?`,
    answer: (
      <>
        Yes, a free account (an email address and a password) gives access to the odds, the value bets, the surebets and
        the freebet conversions. {APP_NAME} takes no bets: it is an information tool. The odds are read at regular
        intervals and may have changed: always check the price at the bookmaker before betting.
      </>
    ),
  },
];

// The ways into the services, on the hero and again to close the page: the dashboard's two lists and the freebets.
function Actions() {
  return (
    <div className={styles.actions}>
      <Link href={valueBetsHref} className={styles.primary}>
        <Gem size={20} aria-hidden="true" />
        See the value bets
      </Link>
      <Link href={oddsHref} className={styles.secondary}>
        <ListOrdered size={20} aria-hidden="true" />
        Compare the odds
      </Link>
      <Link href={FREEBETS_PATH} className={styles.secondary}>
        <Gift size={20} aria-hidden="true" />
        Convert my freebets
      </Link>
    </div>
  );
}

// The home: what the product is, what it brings, and the way into its
// flagship service, the dashboard of odds and value bets (App). A phone first:
// one column, its two buttons within the thumb's reach; from 768 px, the
// sections widen into columns.
export function HomePage() {
  const stats = useHomeStats();
  return (
    <div className={styles.page}>
      <GamblingBanner />
      <HomeHeader />
      <main>
        <section className={styles.hero} aria-labelledby="hero-title">
          <Logo className={styles.radar} />
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}>Odds comparison · value bets · freebets</p>
            <h1 id="hero-title" className={styles.title}>
              The best odds of the German bookmakers, and the bets worth taking.
            </h1>
            <p className={styles.lead}>
              {APP_NAME} compares the odds of {BOOKMAKER_COUNT} bookmakers and spots the ones that pay more than they are
              really worth, measured on the Betfair exchange. It also turns your freebets into guaranteed cash.
            </p>
            <Actions />
            <ul className={styles.trust} aria-label="Bookmakers compared">
              {ALL_BOOKMAKERS.map((id) => (
                <li key={id} className={styles.bookmaker}>
                  <BookmakerLogo bookmaker={id} size={20} decorative />
                  {bookmakerName(id)}
                </li>
              ))}
            </ul>
            <p className={styles.note}>Free account · odds refreshed every few minutes</p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="live-title">
          <h2 id="live-title" className={styles.heading}>
            Right now on {APP_NAME}
          </h2>
          <LiveStats stats={stats} />
          <div className={styles.preview}>
            <LivePreview />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="features-title">
          <h2 id="features-title" className={styles.heading}>
            What {APP_NAME} changes
          </h2>
          <ul className={styles.features}>
            {FEATURES.map(({ title, Icon, text }) => (
              <li key={title} className={styles.feature}>
                <span className={styles.icon}>
                  <Icon size={22} aria-hidden="true" />
                </span>
                <h3 className={styles.featureTitle}>{title}</h3>
                <p className={styles.featureText}>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="freebets-title">
          <h2 id="freebets-title" className={styles.heading}>
            Your freebets, turned into cash
          </h2>
          <p className={styles.lede}>
            A freebet is a stake a bookmaker gives you: if it wins, you collect the winnings, but the stake is not returned.{" "}
            {APP_NAME} looks for how to get real money out of it, whatever the result.
          </p>
          <ul className={styles.ways}>
            {FREEBET_WAYS.map(({ title, Icon, text }) => (
              <li key={title} className={styles.feature}>
                <span className={styles.icon}>
                  <Icon size={22} aria-hidden="true" />
                </span>
                <h3 className={styles.featureTitle}>{title}</h3>
                <p className={styles.featureText}>{text}</p>
              </li>
            ))}
          </ul>
          <p className={styles.lede}>
            The three best conversions are offered, with the bets to place bookmaker by bookmaker. The prices are a guide:
            check them before placing your bets.
          </p>
          <p className={styles.note}>A free account is all it takes: you save your freebets in it.</p>
        </section>

        <section className={styles.section} aria-labelledby="steps-title">
          <h2 id="steps-title" className={styles.heading}>
            How it works
          </h2>
          <ol className={styles.steps}>
            {STEPS.map(({ title, text }, index) => (
              <li key={title} className={styles.step}>
                <span className={`${styles.number} num`} aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className={styles.featureTitle}>{title}</h3>
                <p className={styles.featureText}>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {stats.sports !== null && stats.sports.length > 0 && (
          <section className={styles.section} aria-labelledby="sports-title">
            <h2 id="sports-title" className={styles.heading}>
              The sports covered
            </h2>
            <ul className={styles.sports}>
              {stats.sports.map((sport) => (
                <li key={sport} className={styles.sport}>
                  <span aria-hidden="true">{sportEmoji(sport)}</span> {sportLabel(sport)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.section} aria-labelledby="faq-title">
          <h2 id="faq-title" className={styles.heading}>
            Frequently asked questions
          </h2>
          <div className={styles.faq}>
            {FAQ.map(({ question, answer }) => (
              <details key={question} className={styles.item}>
                <summary className={styles.question}>
                  {question}
                  <ChevronDown size={18} aria-hidden="true" className={styles.chevron} />
                </summary>
                <p className={styles.answer}>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`${styles.section} ${styles.closing}`} aria-labelledby="closing-title">
          <Logo className={styles.closingLogo} />
          <h2 id="closing-title" className={styles.heading}>
            Today's odds are one click away.
          </h2>
          <Actions />
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
