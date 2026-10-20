import { Check } from "lucide-react";
import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { sportLabel } from "../sports";
import { Card } from "./Card";
import { formatFb } from "./format";
import type { BookmakerId, Wallet } from "./freebetsApi";
import { Segmented } from "./Segmented";
import type { Settings } from "./settings";
import styles from "./ConversionControls.module.css";

const MODES = [
  { value: "bookmakers", label: "Zwischen Buchmachern" },
  { value: "exchange", label: "Gegen die Wettbörse" },
] as const;

const FORMATS = [
  { value: "1", label: "Einzelwette" },
  { value: "2", label: "2er-Kombiwette" },
  { value: "3", label: "3er-Kombiwette" },
] as const;

// How the freebets are converted: between bookmakers (a bet or a combo of 2 or 3 matches) or one bookmaker's
// against the exchange, and the sports taken into account. `eligible` are the sports the server found a match
// to convert in (null until it has answered); the ticked ones are `settings.sports`, every one when null.
export function ConversionControls({
  settings,
  onChange,
  wallet,
  holding,
  bookmaker,
  eligible,
}: {
  settings: Settings;
  onChange: (change: Partial<Settings>) => void;
  wallet: Wallet;
  // The bookmakers where the account holds freebets, in the site's order.
  holding: readonly BookmakerId[];
  // The one whose freebets go against the exchange (the first held when none is chosen).
  bookmaker: BookmakerId | null;
  eligible: readonly string[] | null;
}) {
  const ticked = (sport: string) => settings.sports === null || settings.sports.includes(sport);
  const toggle = (sport: string) => {
    const all = eligible ?? [];
    const current = settings.sports ?? all;
    const next = current.includes(sport) ? current.filter((s) => s !== sport) : [...current, sport];
    // Every sport ticked is "every sport", also the ones that are not on offer yet.
    onChange({ sports: all.every((s) => next.includes(s)) ? null : next });
  };

  return (
    <Card id="controls-heading" title="Art der Umwandlung">
      <div className={styles.row}>
        <Segmented legend="Modus" name="mode" value={settings.mode} choices={[...MODES]} onChange={(mode) => onChange({ mode })} />
        {settings.mode === "bookmakers" ? (
          <Segmented
            legend="Wettformat"
            name="legs"
            value={String(settings.legs) as "1" | "2" | "3"}
            choices={[...FORMATS]}
            onChange={(legs) => onChange({ legs: Number(legs) as 1 | 2 | 3 })}
          />
        ) : holding.length > 0 ? (
          <Segmented
            legend="Buchmacher der Freebets"
            name="bookmaker"
            value={bookmaker}
            choices={holding.map((id) => ({
              value: id,
              name: `${BOOKMAKER_BRANDING[id]?.name ?? id}, ${formatFb(wallet[id] ?? 0)} FB`,
              label: (
                <>
                  <BookmakerLogo bookmaker={id} size={18} decorative />
                  {BOOKMAKER_BRANDING[id]?.name ?? id} · <span className="num">{formatFb(wallet[id] ?? 0)} FB</span>
                </>
              ),
            }))}
            onChange={(id) => onChange({ bookmaker: id })}
          />
        ) : (
          <p className={styles.hint}>Trag oben deine Freebets ein: Ein Buchmacher reicht, um sie gegen die Wettbörse umzuwandeln.</p>
        )}
      </div>

      <fieldset className={styles.sports}>
        <legend className={styles.legend}>Berücksichtigte Sportarten</legend>
        {eligible === null ? (
          <p className={styles.hint}>Sportarten werden gesucht…</p>
        ) : eligible.length === 0 ? (
          <p className={styles.hint}>Gerade hat keine Sportart ein Spiel zum Umwandeln.</p>
        ) : (
          <div className={styles.chips}>
            {eligible.map((sport) => (
              <button key={sport} type="button" className={ticked(sport) ? styles.chipOn : styles.chip} aria-pressed={ticked(sport)} onClick={() => toggle(sport)}>
                {ticked(sport) && <Check size={14} aria-hidden="true" />}
                {sportLabel(sport)}
              </button>
            ))}
          </div>
        )}
        <p className={styles.hint}>
          {settings.mode === "bookmakers"
            ? "Eine Kombiwette kann mehrere Sportarten mischen: Wähle die aus, deren Spiele für dich infrage kommen. Angeboten werden nur passende Sportarten (ein Ergebnis mit 2 oder 3 Ausgängen)."
            : "Die Sportarten mit Quoten an der Wettbörse. Nur Einzelwetten: Die Wettbörse bietet keine Kombiwetten an."}
        </p>
      </fieldset>

      {settings.mode === "bookmakers" && (
        <p className={styles.info}>
          Genutzte Buchmacher (die, bei denen du FB hast):{" "}
          {holding.length === 0
            ? "noch keine. "
            : holding.map((id) => (
                <span key={id} className={styles.pill}>
                  <BookmakerLogo bookmaker={id} size={16} decorative />
                  {BOOKMAKER_BRANDING[id]?.name ?? id}
                </span>
              ))}{" "}
          Mindestens zwei sind nötig.
        </p>
      )}
    </Card>
  );
}
