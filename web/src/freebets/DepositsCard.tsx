import { TriangleAlert } from "lucide-react";
import { BookmakerLogo } from "../BookmakerLogo";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import { Card } from "./Card";
import { formatEuro } from "./format";
import { LUGAS_BOOKMAKERS, type DepositsState } from "./useDeposits";
import styles from "./WalletCard.module.css";

const MONTH = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

// LUGAS's monthly deposit limit across the German-licensed bookmakers: the
// deposits the account writes down this month, their total against the
// limit, and what is left. Saved with the account when a field is left.
export function DepositsCard({ deposits }: { deposits: DepositsState }) {
  const { held } = deposits;
  const month = held ? MONTH.format(new Date(`${held.month}-15T12:00:00Z`)) : "";
  const left = held ? held.limit - held.total : 0;
  return (
    <Card id="deposits-heading" title="Einzahlungslimit (LUGAS)">
      <p className={styles.hint}>
        In Deutschland lizenzierte Buchmacher teilen sich ein Einzahlungslimit von standardmäßig 1.000 € pro Monat. Trag deine
        Einzahlungen dieses Monats ein, um zu sehen, was noch übrig ist. 20bet zählt nicht dazu.
      </p>
      {deposits.status === "loading" && (
        <p className={styles.hint} aria-busy="true">
          Deine Einzahlungen werden geladen…
        </p>
      )}
      {deposits.status === "failed" && (
        <p role="alert" className={styles.error}>
          <TriangleAlert size={16} aria-hidden="true" /> Deine Einzahlungen konnten nicht geladen werden.{" "}
          <button type="button" className={styles.link} onClick={deposits.retry}>
            Einzahlungen erneut laden
          </button>
        </p>
      )}
      {deposits.status === "ready" && held && (
        <>
          <div className={styles.tiles}>
            {LUGAS_BOOKMAKERS.map((id) => {
              const name = BOOKMAKER_BRANDING[id]?.name ?? id;
              const bad = deposits.invalid.has(id);
              return (
                <div key={id} className={styles.cell}>
                  <label className={(held.deposits[id] ?? 0) > 0 ? styles.tileOn : styles.tile}>
                    <BookmakerLogo bookmaker={id} size={24} decorative />
                    <span className={styles.name}>{name}</span>
                    <span className={styles.field}>
                      <input
                        className={`${styles.input} num`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={deposits.texts[id] ?? ""}
                        placeholder="0"
                        aria-label={`Einzahlungen bei ${name} im ${month} in Euro`}
                        aria-invalid={bad}
                        onChange={(event) => deposits.setText(id, event.target.value)}
                        onBlur={deposits.commit}
                      />
                      <span className={styles.unit}>€</span>
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
          <p className={styles.total} role="status">
            {month}: <b className="num">{formatEuro(held.total)}</b> von {formatEuro(held.limit)} eingezahlt
            {left > 0 ? ` · noch ${formatEuro(left)} frei` : " · Limit erreicht"}
            {deposits.saving && " · wird gespeichert…"}
            {deposits.saveFailed && (
              <>
                {" · Speichern fehlgeschlagen. "}
                <button type="button" className={styles.link} onClick={deposits.retry}>
                  Einzahlungen erneut speichern
                </button>
              </>
            )}
          </p>
        </>
      )}
    </Card>
  );
}
