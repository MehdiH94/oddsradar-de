import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { BookmakerLogo } from "../BookmakerLogo";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "../bookmakers";
import { Card } from "./Card";
import { formatFb, MAX_FREEBET } from "./format";
import type { WalletState } from "./useWallet";
import styles from "./WalletCard.module.css";

function SaveStatus({ wallet }: { wallet: WalletState }) {
  switch (wallet.save) {
    case "pending":
    case "saving":
      return (
        <>
          <LoaderCircle size={16} aria-hidden="true" className={styles.spinning} /> Wird gespeichert…
        </>
      );
    case "invalid":
      return (
        <>
          <TriangleAlert size={16} aria-hidden="true" /> Korrigiere die markierten Beträge, um sie zu speichern
        </>
      );
    case "failed":
      return (
        <>
          <TriangleAlert size={16} aria-hidden="true" /> Speichern fehlgeschlagen.{" "}
          <button type="button" className={styles.link} onClick={wallet.retry}>
            Erneut versuchen
          </button>
        </>
      );
    default:
      return (
        <>
          <Check size={16} aria-hidden="true" /> In deinem Konto gespeichert
        </>
      );
  }
}

// The freebets the account holds at each bookmaker (1 FB = 1 euro), kept on the account a moment after the last
// change (useWallet): the calculations below are made on what the server holds.
export function WalletCard({ wallet }: { wallet: WalletState }) {
  const ready = wallet.status === "ready";
  return (
    <Card id="wallet-heading" title="Meine Freebets" aside={ready ? <span role="status" className={styles.save}><SaveStatus wallet={wallet} /></span> : undefined}>
      <p className={styles.hint}>
        Trag die Freebets (FB) ein, die du bei jedem Buchmacher noch hast. 1 FB = 1 €. Du findest sie auf all deinen Geräten wieder.
      </p>
      {wallet.status === "loading" && (
        <p className={styles.hint} aria-busy="true">
          Deine Freebets werden geladen…
        </p>
      )}
      {wallet.status === "failed" && (
        <p role="alert" className={styles.error}>
          <TriangleAlert size={16} aria-hidden="true" /> Deine Freebets konnten nicht geladen werden.{" "}
          <button type="button" className={styles.link} onClick={wallet.retry}>
            Erneut versuchen
          </button>
        </p>
      )}
      {ready && (
        <>
          <div className={styles.tiles}>
            {ALL_BOOKMAKERS.map((id) => {
              const name = BOOKMAKER_BRANDING[id]?.name ?? id;
              const bad = wallet.invalid.has(id);
              const filled = (wallet.wallet[id] ?? 0) > 0;
              return (
                <div key={id} className={styles.cell}>
                  <label className={filled ? styles.tileOn : styles.tile}>
                    <BookmakerLogo bookmaker={id} size={24} decorative />
                    <span className={styles.name}>{name}</span>
                    <span className={styles.field}>
                      <input
                        className={`${styles.input} num`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={wallet.texts[id]}
                        placeholder="0"
                        aria-label={`Freebets bei ${name} in Euro`}
                        aria-invalid={bad}
                        aria-describedby={bad ? `wallet-error-${id}` : undefined}
                        onChange={(event) => wallet.setText(id, event.target.value)}
                        onBlur={() => wallet.tidy(id)}
                      />
                      <span className={styles.unit}>FB</span>
                    </span>
                  </label>
                  {bad && (
                    <p id={`wallet-error-${id}`} className={styles.invalid}>
                      Ungültiger Betrag: eine Zahl von 0 bis {MAX_FREEBET.toLocaleString("de-DE")}.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className={styles.total}>
            Insgesamt umzuwandeln <b className="num">{formatFb(wallet.total)} FB</b>
          </p>
        </>
      )}
    </Card>
  );
}
