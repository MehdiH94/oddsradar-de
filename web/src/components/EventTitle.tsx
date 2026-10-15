import { sportEmoji, sportLabel } from "../sports";
import styles from "./EventTitle.module.css";

// An event's title in the value bets' category (ValueBetsTable, SurebetsTable):
// the sport's icon, named for whoever doesn't know it, then the title, which
// always leads to the event's page (MatchPage), whatever number of markets it
// has. Only where the table knows no such page does it lead to its sport's
// page searched on the event, and it is plain text where the table is given
// nowhere to lead to.
export function EventTitle({
  eventId,
  sport,
  title,
  matchHref,
  onOpenMatch,
  sportHref,
  className,
}: {
  eventId: string;
  sport: string;
  title: string;
  // A match's page, like the "+N marchés" link's.
  matchHref?: (id: string) => string;
  onOpenMatch?: (id: string) => void;
  // The sport's page, searched on the title.
  sportHref?: (sport: string, q: string) => string;
  className?: string;
}) {
  const label = sportLabel(sport);
  const hasPage = matchHref !== undefined;
  const href = hasPage ? matchHref(eventId) : sportHref?.(sport, title);
  return (
    <span className={className}>
      <span role="img" aria-label={label} title={label} className={styles.icon}>
        {sportEmoji(sport)}
      </span>{" "}
      {href === undefined ? (
        title
      ) : (
        <a
          className={styles.link}
          href={href}
          onClick={(e) => {
            // The sport's page is a page of its own; only the match's opens in
            // place, and a new tab keeps the link's own way.
            if (!hasPage || !onOpenMatch || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpenMatch(eventId);
          }}
        >
          {title}
        </a>
      )}
    </span>
  );
}
