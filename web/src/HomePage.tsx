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
    title: "Vergleichen, ohne von Seite zu Seite zu springen",
    Icon: ListOrdered,
    text: (
      <>
        Für jedes Spiel die Quoten der {BOOKMAKER_COUNT} Buchmacher nebeneinander. Die beste Quote jedes Ausgangs ist grün
        und abgehakt. Die Auszahlungsquote fasst die Marge der Buchmacher zusammen: Je näher an 100 %, desto weniger behalten sie.
      </>
    ),
  },
  {
    title: "Value Bets erkennen",
    Icon: Gem,
    text: (
      <>
        Eine Quote ist eine Value Bet, wenn sie mindestens {formatPercent(VALUE_MIN_EDGE)} über der fairen Quote liegt: dem Kurs
        der Betfair-Wettbörse ohne ihre Marge. Der Vorteil wird angezeigt, damit du weißt, wo du zuerst hinschauen solltest.
      </>
    ),
  },
  {
    title: "Ein Spiel bis ins Detail",
    Icon: Layers,
    text: (
      <>
        Für die nächsten 48 Stunden Fußball, Tennis und Basketball werden die Märkte eines Spiels (Torschützen, Über/Unter,
        Handicaps…) zwischen den Buchmachern verglichen. Ergeben die besten Quoten eines Markts eine Auszahlungsquote über
        100 %, wird er als Surebet markiert.
      </>
    ),
  },
];

const STEPS: ReadonlyArray<{ title: string; text: ReactNode }> = [
  {
    title: "Wir lesen die Quoten",
    text: `Alle paar Minuten lesen wir die Pre-Match-Quoten von ${ALL_BOOKMAKERS_SENTENCE}.`,
  },
  {
    title: "Wir vergleichen sie mit der fairen Quote",
    text: "Sie stammt von der Betfair-Wettbörse, auf der die Wettenden die Kurse selbst bestimmen, abzüglich ihrer Marge.",
  },
  {
    title: "Du siehst den Vorteil",
    text: "Eine Quote über der fairen Quote wird umrahmt, mit ihrem Vorteil: „+2,1 %“ heißt, sie zahlt 2,1 % mehr.",
  },
];

// The freebets' conversions, said in two ways: what each one asks of the account (the exchange's lay is advanced).
const FREEBET_WAYS: ReadonlyArray<{ title: string; Icon: typeof Gem; text: ReactNode }> = [
  {
    title: "Zwischen Buchmachern",
    Icon: ArrowLeftRight,
    text: "Deine Freebets bei mehreren Buchmachern, verteilt auf eine Einzelwette oder eine Kombi aus 2 oder 3 Spielen, sodass du bei jedem Ergebnis denselben Betrag bekommst. Kein echtes Geld im Einsatz.",
  },
  {
    title: "Gegen die Wettbörse",
    Icon: Scale,
    text: "Mit den Freebets eines Buchmachers setzt du auf einen Ausgang, und derselbe Ausgang wird an der Wettbörse gelayt: Der Gewinn ist garantiert, im Rahmen des an der Wettbörse verfügbaren Gelds. Die Haftung des Lays streckst du vor, du bekommst sie nach dem Spiel zurück.",
  },
];

const FAQ: ReadonlyArray<{ question: string; answer: ReactNode }> = [
  {
    question: "Was ist eine Value Bet?",
    answer: (
      <>
        Eine Wette, deren Quote höher ist, als die Chancen des Ausgangs wirklich wert sind. {APP_NAME} schätzt diesen Wert mit
        der fairen Quote {REFERENCE_SOURCE} und markiert jede Quote, die mindestens {formatPercent(VALUE_MIN_EDGE)} darüber liegt (
        {formatPercent(PLAYER_VALUE_MIN_EDGE)} bei Spielermärkten). Das ist ein Hinweis, keine Gewissheit: Auch eine Wette über der
        fairen Quote kann verlieren.
      </>
    ),
  },
  {
    question: "Woher kommt die faire Quote?",
    answer: (
      <>
        Es ist der Kurs {REFERENCE_SOURCE} abzüglich ihrer Marge. An einer Wettbörse bestimmen die Wettenden die Kurse:
        Das ist die Referenz, die den echten Wahrscheinlichkeiten am nächsten kommt. Ist an der Wettbörse zu wenig Geld auf einem
        Ausgang,{" "}zeigt {APP_NAME} keine faire Quote.
      </>
    ),
  },
  {
    question: "Was ist eine Surebet?",
    answer: (
      <>
        Ein Markt, dessen beste Quoten zusammen in jedem Fall einen Gewinn garantieren würden (eine Auszahlungsquote über 100 %).{" "}
        {APP_NAME} zeigt sie oben bei den Value Bets. Aber die Regeln desselben Markts können sich von Buchmacher zu Buchmacher
        unterscheiden, und eine Quote kann sich vor deiner Wette ändern: Prüf sie immer.
      </>
    ),
  },
  {
    question: "Was ist eine Freebet, und wie macht man daraus Geld?",
    answer: (
      <>
        Eine Freebet ist ein Einsatz, den dir ein Buchmacher schenkt: Gewinnt sie, bekommst du den Gewinn, aber nicht den Einsatz.
        Im Bereich Freebets berechnet {APP_NAME}, wie du sie verteilst, um bei jedem Ergebnis denselben Betrag zu bekommen:
        zwischen mehreren Buchmachern oder mit einer Wette beim Buchmacher und einem Lay an der Wettbörse. Du bekommst einen Teil
        des Werts der Freebet, nie alles, je nach aktuellen Quoten: Prüf sie, bevor du deine Wetten platzierst.
      </>
    ),
  },
  {
    question: `Brauche ich ein Konto? Kann ich auf ${APP_NAME} wetten?`,
    answer: (
      <>
        Ja, ein kostenloses Konto (eine E-Mail-Adresse und ein Passwort) gibt dir Zugang zu den Quoten, den Value Bets, den
        Surebets und den Freebet-Umwandlungen. {APP_NAME} nimmt keine Wetten an: Es ist ein Informationsangebot. Die Quoten
        werden regelmäßig gelesen und können sich geändert haben: Prüf die Quote immer beim Buchmacher, bevor du wettest.
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
        Value Bets ansehen
      </Link>
      <Link href={oddsHref} className={styles.secondary}>
        <ListOrdered size={20} aria-hidden="true" />
        Quoten vergleichen
      </Link>
      <Link href={FREEBETS_PATH} className={styles.secondary}>
        <Gift size={20} aria-hidden="true" />
        Meine Freebets umwandeln
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
            <p className={styles.eyebrow}>Quotenvergleich · Value Bets · Freebets</p>
            <h1 id="hero-title" className={styles.title}>
              Die besten Quoten der deutschen Buchmacher, und die Wetten, die sich lohnen.
            </h1>
            <p className={styles.lead}>
              {APP_NAME} vergleicht die Quoten von {BOOKMAKER_COUNT} Buchmachern und findet die, die mehr zahlen, als sie wirklich
              wert sind, gemessen an der Betfair-Wettbörse. Außerdem macht es aus deinen Freebets garantiertes Geld.
            </p>
            <Actions />
            <ul className={styles.trust} aria-label="Verglichene Buchmacher">
              {ALL_BOOKMAKERS.map((id) => (
                <li key={id} className={styles.bookmaker}>
                  <BookmakerLogo bookmaker={id} size={20} decorative />
                  {bookmakerName(id)}
                </li>
              ))}
            </ul>
            <p className={styles.note}>Kostenloses Konto · Quoten alle paar Minuten aktualisiert</p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="live-title">
          <h2 id="live-title" className={styles.heading}>
            Gerade auf {APP_NAME}
          </h2>
          <LiveStats stats={stats} />
          <div className={styles.preview}>
            <LivePreview />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="features-title">
          <h2 id="features-title" className={styles.heading}>
            Was {APP_NAME} dir bringt
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
            Deine Freebets, in Geld verwandelt
          </h2>
          <p className={styles.lede}>
            Eine Freebet ist ein Einsatz, den dir ein Buchmacher schenkt: Gewinnt sie, bekommst du den Gewinn, aber nicht den Einsatz.{" "}
            {APP_NAME} sucht, wie du daraus echtes Geld machst, egal wie das Spiel ausgeht.
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
            Du bekommst die drei besten Umwandlungen, mit den Wetten, die du bei jedem Buchmacher platzierst. Die Quoten sind ein
            Richtwert: Prüf sie, bevor du deine Wetten platzierst.
          </p>
          <p className={styles.note}>Ein kostenloses Konto genügt: Darin speicherst du deine Freebets.</p>
        </section>

        <section className={styles.section} aria-labelledby="steps-title">
          <h2 id="steps-title" className={styles.heading}>
            So funktioniert es
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
              Die Sportarten
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
            Häufige Fragen
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
            Die Quoten von heute sind nur einen Klick entfernt.
          </h2>
          <Actions />
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
