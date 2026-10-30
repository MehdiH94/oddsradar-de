import { useState, type FormEvent } from "react";
import { BookmakerLogo } from "../BookmakerLogo";
import { ALL_BOOKMAKER_NAMES } from "../bookmakers";
import { AppFooter } from "../components/AppFooter";
import { AppHeader } from "../components/AppHeader";
import { AppNav, type View } from "../components/AppNav";
import { GamblingBanner } from "../components/GamblingBanner";
import { Card } from "../freebets/Card";
import { FREEBETS_PATH, navigate, oddsHref, valueBetsHref } from "../routes";
import { useIsWide } from "../useMediaQuery";
import { countNew, endLabel, endOfDay, groupByBookmaker, isNew, usePromos, type NewPromo, type Promo, type PromosState } from "./promosApi";
import styles from "./PromosPage.module.css";

// The Promos page, for accounts: the bookmakers' promotions, one card per
// bookmaker, each marked as taken or not (kept on the account). For now the
// account writes down those it receives (by e-mail, on Telegram); those the
// site finds on the bookmakers' pages will join them.
export function PromosPage() {
  const wide = useIsWide();
  const promos = usePromos();

  function changeView(view: View) {
    if (view === "value-bets") navigate(valueBetsHref);
    else if (view === "matches") navigate(oddsHref);
    else if (view === "freebets") navigate(FREEBETS_PATH);
  }
  const nav = <AppNav view="promos" onChange={changeView} placement={wide ? "header" : "bar"} newPromos={countNew(promos.promos)} />;
  const groups = groupByBookmaker(promos.promos);
  const open = promos.promos.filter((p) => !p.takenAt).length;

  return (
    <div className={wide ? styles.app : `${styles.app} ${styles.withBar}`}>
      <GamblingBanner sportsBetting />
      <AppHeader lastUpdated={promos.updatedAt} refreshing={promos.status === "loading"} failed={promos.status === "error"} onRefresh={promos.reload}>
        {wide && nav}
      </AppHeader>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Promos</h1>
          <p className={styles.subtitle}>
            Keine Aktion mehr verpassen: trag die Promos ein, die du per E-Mail oder Telegram bekommst, und hake ab, was du schon genommen hast.
          </p>
        </div>
        <div className={styles.stack}>
          <label className={styles.remind}>
            <input type="checkbox" checked={promos.remind} onChange={(event) => promos.setRemind(event.target.checked)} />
            E-Mail am Vortag, wenn eine offene Promo endet
          </label>
          <AddPromo add={promos.add} />
          {promos.status === "error" && (
            <p className={styles.notice} role="alert">
              Die Promos konnten nicht geladen werden. Bitte lade die Seite neu.
            </p>
          )}
          {promos.status === "ready" && groups.length === 0 && (
            <p className={styles.notice}>Noch keine Promo. Trag oben die erste ein.</p>
          )}
          {groups.length > 0 && (
            <p className={styles.count} aria-live="polite">
              {open === 1 ? "1 offene Promo" : `${open} offene Promos`}
            </p>
          )}
          {groups.map((group) => (
            <Card
              key={group.key}
              id={`promos-${group.key.replace(/[^a-z0-9]+/g, "-")}`}
              title={
                <span className={styles.bookmaker}>
                  {group.id && <BookmakerLogo bookmaker={group.id} size={24} decorative />}
                  {group.name}
                </span>
              }
              aside={`${group.promos.filter((p) => !p.takenAt).length} offen`}
            >
              <ul className={styles.list}>
                {group.promos.map((promo) => (
                  <PromoItem key={promo.id} promo={promo} promos={promos} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </main>
      <AppFooter />
      {!wide && nav}
    </div>
  );
}

function PromoItem({ promo, promos }: { promo: Promo; promos: PromosState }) {
  const taken = promo.takenAt !== null;
  const end = endLabel(promo.endsAt);
  return (
    <li className={styles.promo} data-taken={taken || undefined}>
      <div className={styles.body}>
        <h3 className={styles.promoTitle}>
          {isNew(promo) && (
            <>
              <span className={styles.newBadge}>Neu</span>{" "}
            </>
          )}
          {promo.title}
        </h3>
        {promo.details && <p className={styles.details}>{promo.details}</p>}
        <p className={styles.meta}>
          {end && <span data-expired={end === "Abgelaufen" || undefined}>{end}</span>}
          {promo.url && (
            <a href={promo.url} target="_blank" rel="noopener noreferrer" aria-label={`Zur Aktion: ${promo.title}`}>
              Zur Aktion
            </a>
          )}
        </p>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.takenButton}
          // One name, its state told by aria-pressed.
          aria-label={`Genommen: ${promo.title}`}
          aria-pressed={taken}
          onClick={() => promos.setTaken(promo.id, !taken)}
        >
          {taken ? "✓ Genommen" : "Genommen?"}
        </button>
        {promo.mine && (
          <button type="button" className={styles.removeButton} aria-label={`Löschen: ${promo.title}`} onClick={() => promos.remove(promo.id)}>
            Löschen
          </button>
        )}
      </div>
    </li>
  );
}

const EMPTY = { bookmaker: "", title: "", details: "", url: "", endsOn: "" };

// The form to write a promo down: the bookmaker (one the site knows is
// suggested, any other may be typed) and the title are needed.
function AddPromo({ add }: { add: PromosState["add"] }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const promo: NewPromo = {
      bookmaker: form.bookmaker.trim(),
      title: form.title.trim(),
      details: form.details.trim(),
      url: form.url.trim() || null,
      endsAt: form.endsOn ? endOfDay(form.endsOn) : null,
    };
    setBusy(true);
    const error = await add(promo);
    setBusy(false);
    if (error) {
      setMessage({ error: true, text: error });
      return;
    }
    setForm(EMPTY);
    setMessage({ error: false, text: "Promo gespeichert." });
  }

  const field = (name: keyof typeof EMPTY) => ({
    name,
    value: form[name],
    onChange: (event: { target: { value: string } }) => setForm((current) => ({ ...current, [name]: event.target.value })),
  });

  return (
    <Card id="promo-add" title="Promo eintragen">
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          Buchmacher
          <input {...field("bookmaker")} list="promo-bookmakers" required maxLength={60} placeholder="z. B. Winamax, Stake" autoComplete="off" />
          <datalist id="promo-bookmakers">
            {ALL_BOOKMAKER_NAMES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          Titel
          <input {...field("title")} required maxLength={160} placeholder="z. B. 100 % bis 100 € Bonus" />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Bedingungen (optional)
          <textarea {...field("details")} maxLength={2000} rows={3} placeholder="Umsatz, Mindestquote, Code …" />
        </label>
        <label className={styles.field}>
          Link (optional)
          <input {...field("url")} type="url" placeholder="https://" />
        </label>
        <label className={styles.field}>
          Gültig bis (optional)
          <input {...field("endsOn")} type="date" />
        </label>
        <div className={`${styles.submitRow} ${styles.wide}`}>
          <button type="submit" className={styles.submit} disabled={busy}>
            Promo speichern
          </button>
          {message && (
            <span className={message.error ? styles.error : styles.saved} role={message.error ? "alert" : "status"}>
              {message.text}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}
