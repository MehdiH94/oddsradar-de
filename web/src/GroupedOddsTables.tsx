import type { EventWithOdds } from "./types";
import { OddsTable } from "./OddsTable";
import { OutrightTable } from "./OutrightTable";
import { isOutright } from "./outright";
import { groupBySport } from "./groupBySport";
import { ALL_BOOKMAKERS } from "./bookmakers";
import { sportEmoji, sportLabel } from "./sports";
import styles from "./GroupedOddsTables.module.css";

export function GroupedOddsTables({
  events,
  bookmakers = ALL_BOOKMAKERS,
  groupByDay = false,
  matchHref,
  onOpenMatch,
}: {
  events: EventWithOdds[];
  bookmakers?: readonly string[];
  // Sorted by kick-off: a heading for each day (OddsTable).
  groupByDay?: boolean;
  // A match's page (MatchPage), linked from its row when it has more markets.
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
}) {
  return (
    <>
      {groupBySport(events).map(([sport, sportEvents]) => {
        // Winner-among-N markets (a race, a golf tournament) don't fit the
        // 1 / N / 2 columns: each gets a card of its own, below the matches.
        const outrights = sportEvents.filter(isOutright);
        const matches = sportEvents.filter((event) => !isOutright(event));
        return (
          <section key={sport} className={styles.section} aria-labelledby={`sport-${sport}`}>
            <h2 id={`sport-${sport}`} className={`${styles.heading} ${styles.sportHeading}`}>
              <span aria-hidden="true">{sportEmoji(sport)}</span> {sportLabel(sport)}
            </h2>
            {matches.length > 0 && (
              <OddsTable
                events={matches}
                bookmakers={bookmakers}
                groupByDay={groupByDay}
                matchHref={matchHref}
                onOpenMatch={onOpenMatch}
              />
            )}
            {outrights.length > 0 && (
              <OutrightTable events={outrights} bookmakers={bookmakers} matchHref={matchHref} onOpenMatch={onOpenMatch} />
            )}
          </section>
        );
      })}
    </>
  );
}
