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
          <LoaderCircle size={16} aria-hidden="true" className={styles.spinning} /> Enregistrement…
        </>
      );
    case "invalid":
      return (
        <>
          <TriangleAlert size={16} aria-hidden="true" /> Corrigez les montants signalés pour les enregistrer
        </>
      );
    case "failed":
      return (
        <>
          <TriangleAlert size={16} aria-hidden="true" /> Enregistrement impossible.{" "}
          <button type="button" className={styles.link} onClick={wallet.retry}>
            Réessayer
          </button>
        </>
      );
    default:
      return (
        <>
          <Check size={16} aria-hidden="true" /> Enregistré sur votre compte
        </>
      );
  }
}

// The freebets the account holds at each bookmaker (1 FB = 1 euro), kept on the account a moment after the last
// change (useWallet): the calculations below are made on what the server holds.
export function WalletCard({ wallet }: { wallet: WalletState }) {
  const ready = wallet.status === "ready";
  return (
    <Card id="wallet-heading" title="Mes freebets" aside={ready ? <span role="status" className={styles.save}><SaveStatus wallet={wallet} /></span> : undefined}>
      <p className={styles.hint}>
        Indiquez les freebets (FB) qu'il vous reste chez chaque bookmaker. 1 FB = 1 €. Vous les retrouvez sur tous vos appareils.
      </p>
      {wallet.status === "loading" && (
        <p className={styles.hint} aria-busy="true">
          Chargement de vos freebets…
        </p>
      )}
      {wallet.status === "failed" && (
        <p role="alert" className={styles.error}>
          <TriangleAlert size={16} aria-hidden="true" /> Impossible de charger vos freebets.{" "}
          <button type="button" className={styles.link} onClick={wallet.retry}>
            Réessayer
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
                        aria-label={`Freebets ${name} en euros`}
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
                      Montant invalide : un nombre de 0 à {MAX_FREEBET.toLocaleString("fr-FR")}.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className={styles.total}>
            Total à convertir <b className="num">{formatFb(wallet.total)} FB</b>
          </p>
        </>
      )}
    </Card>
  );
}
