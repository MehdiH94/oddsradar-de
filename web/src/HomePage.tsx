import type { ReactNode } from "react";
import { ArrowLeftRight, ChevronDown, Gem, Gift, Layers, ListOrdered, Scale } from "lucide-react";
import { ALL_BOOKMAKERS, ALL_BOOKMAKERS_SENTENCE, BOOKMAKER_BRANDING } from "./bookmakers";
import { BookmakerLogo } from "./BookmakerLogo";
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
    title: "Comparer sans courir d'un site à l'autre",
    Icon: ListOrdered,
    text: (
      <>
        Pour chaque match, la cote de chacun des {BOOKMAKER_COUNT} bookmakers côte à côte. La meilleure cote de chaque
        issue est en vert, cochée. Le TRJ (taux de retour au joueur) résume la marge des bookmakers : plus il est
        proche de 100 %, moins ils en prennent.
      </>
    ),
  },
  {
    title: "Repérer les value bets",
    Icon: Gem,
    text: (
      <>
        Une cote est un value bet quand elle dépasse d'au moins {formatPercent(VALUE_MIN_EDGE)} la cote juste : celle de
        l'exchange Betfair, débarrassée de sa marge. L'écart s'affiche, pour savoir où regarder en premier.
      </>
    ),
  },
  {
    title: "Aller au fond d'un match",
    Icon: Layers,
    text: (
      <>
        Pour le foot, le tennis et le basket des 48 prochaines heures, les marchés du match (buteurs, totaux, handicaps…)
        sont comparés d'un bookmaker à l'autre. Quand les meilleures cotes d'un marché dépassent 100 % de TRJ, il est
        signalé comme surebet.
      </>
    ),
  },
];

const STEPS: ReadonlyArray<{ title: string; text: ReactNode }> = [
  {
    title: "On relève les cotes",
    text: `Toutes les quelques minutes, nous lisons les cotes de ${ALL_BOOKMAKERS_SENTENCE} avant les matchs.`,
  },
  {
    title: "On les confronte à la cote juste",
    text: "Elle vient de l'exchange Betfair, où les parieurs fixent eux-mêmes les prix, une fois sa marge retirée.",
  },
  {
    title: "Vous voyez l'écart",
    text: "Une cote au-dessus de la cote juste est encadrée, avec son écart : « +2,1 % » veut dire qu'elle paie 2,1 % de plus.",
  },
];

// The freebets' conversions, said in two ways: what each one asks of the account (the exchange's lay is advanced).
const FREEBET_WAYS: ReadonlyArray<{ title: string; Icon: typeof Gem; text: ReactNode }> = [
  {
    title: "Entre bookmakers",
    Icon: ArrowLeftRight,
    text: "Vos freebets de plusieurs bookmakers, répartis sur un pari simple ou un combiné de 2 ou 3 matchs, de façon à toucher la même somme quel que soit le résultat. Aucune mise d'argent réel.",
  },
  {
    title: "Contre l'exchange",
    Icon: Scale,
    text: "Les freebets d'un bookmaker jouent une issue, et la même issue est « layée » sur l'exchange : le gain est garanti, dans la limite de l'argent disponible sur l'exchange. La mise du lay est avancée, puis rendue après le match.",
  },
];

const FAQ: ReadonlyArray<{ question: string; answer: ReactNode }> = [
  {
    question: "C'est quoi un value bet ?",
    answer: (
      <>
        Un pari dont la cote est supérieure à ce que valent réellement les chances de l'issue. CoteRadar estime cette
        valeur avec la cote juste de {REFERENCE_SOURCE} et signale toute cote qui la dépasse d'au moins{" "}
        {formatPercent(VALUE_MIN_EDGE)} ({formatPercent(PLAYER_VALUE_MIN_EDGE)} sur les marchés de joueurs). C'est un
        indicateur, pas une certitude : un pari au-dessus de la cote juste peut perdre.
      </>
    ),
  },
  {
    question: "D'où vient la cote juste ?",
    answer: (
      <>
        C'est la cote de {REFERENCE_SOURCE} une fois sa marge retirée. Sur un exchange, ce sont les parieurs qui fixent
        les prix : c'est la référence la plus proche des vraies probabilités. Quand l'exchange cote trop peu d'argent
        sur une issue, CoteRadar n'affiche pas de cote juste.
      </>
    ),
  },
  {
    question: "Qu'est-ce qu'un surebet ?",
    answer: (
      <>
        Un marché dont les meilleures cotes, combinées, garantiraient un gain quoi qu'il arrive (TRJ au-dessus de 100 %).
        CoteRadar les signale en tête de la liste des value bets. Mais les règles d'un même marché peuvent différer d'un
        bookmaker à l'autre et une cote peut changer avant que vous ne pariez : vérifiez toujours.
      </>
    ),
  },
  {
    question: "C'est quoi un freebet, et comment le convertir en cash ?",
    answer: (
      <>
        Un freebet est une mise offerte par un bookmaker : s'il gagne, vous touchez le gain, mais la mise n'est pas
        rendue. Dans l'onglet Freebets, CoteRadar calcule comment le répartir pour toucher la même somme quel que soit le
        résultat : entre plusieurs bookmakers, ou en jouant l'issue chez un bookmaker et en la layant sur l'exchange. Vous
        obtenez une fraction de la valeur du freebet, jamais sa valeur entière, qui dépend des cotes du moment : vérifiez-les
        avant de placer vos paris.
      </>
    ),
  },
  {
    question: "Faut-il un compte ? Peut-on parier sur CoteRadar ?",
    answer: (
      <>
        Oui, un compte gratuit (adresse email et mot de passe) donne accès aux cotes, aux value bets, aux surebets et à la conversion de freebets. CoteRadar ne prend aucun pari : c'est un outil d'information. Les cotes sont
        relevées à intervalles réguliers et ont pu changer : vérifiez toujours la cote chez le bookmaker avant de
        parier.
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
        Voir les value bets
      </Link>
      <Link href={oddsHref} className={styles.secondary}>
        <ListOrdered size={20} aria-hidden="true" />
        Comparer les cotes
      </Link>
      <Link href={FREEBETS_PATH} className={styles.secondary}>
        <Gift size={20} aria-hidden="true" />
        Convertir mes freebets
      </Link>
    </div>
  );
}

// CoteRadar's home: what the product is, what it brings, and the way into its
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
            <p className={styles.eyebrow}>Comparateur de cotes · value bets · freebets</p>
            <h1 id="hero-title" className={styles.title}>
              Les meilleures cotes des bookmakers français, et les paris qui valent le coup.
            </h1>
            <p className={styles.lead}>
              CoteRadar compare les cotes de {BOOKMAKER_COUNT} bookmakers et repère celles qui paient plus que leur vraie
              valeur, mesurée sur l'exchange Betfair. Elle convertit aussi vos freebets en cash garanti.
            </p>
            <Actions />
            <ul className={styles.trust} aria-label="Bookmakers comparés">
              {ALL_BOOKMAKERS.map((id) => (
                <li key={id} className={styles.bookmaker}>
                  <BookmakerLogo bookmaker={id} size={20} decorative />
                  {bookmakerName(id)}
                </li>
              ))}
            </ul>
            <p className={styles.note}>Compte gratuit · cotes actualisées toutes les quelques minutes</p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="live-title">
          <h2 id="live-title" className={styles.heading}>
            En ce moment sur CoteRadar
          </h2>
          <LiveStats stats={stats} />
          <div className={styles.preview}>
            <LivePreview />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="features-title">
          <h2 id="features-title" className={styles.heading}>
            Ce que CoteRadar change
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
            Vos freebets, convertis en cash
          </h2>
          <p className={styles.lede}>
            Un freebet est une mise offerte par un bookmaker : s'il gagne, vous touchez le gain, mais la mise n'est pas
            rendue. CoteRadar cherche comment en tirer de l'argent réel, quel que soit le résultat.
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
            Les trois meilleures conversions sont proposées, avec les paris à placer bookmaker par bookmaker. Les cotes sont
            indicatives : vérifiez-les avant de placer vos paris.
          </p>
          <p className={styles.note}>Un compte gratuit suffit : vous y enregistrez vos freebets.</p>
        </section>

        <section className={styles.section} aria-labelledby="steps-title">
          <h2 id="steps-title" className={styles.heading}>
            Comment ça marche
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
              Les sports couverts
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
            Questions fréquentes
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
            Les cotes du jour sont à un clic.
          </h2>
          <Actions />
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
