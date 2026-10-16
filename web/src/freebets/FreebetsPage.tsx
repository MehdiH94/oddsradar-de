import { useEffect, useMemo, useState } from "react";
import { ALL_BOOKMAKERS } from "../bookmakers";
import { AppFooter } from "../components/AppFooter";
import { AppHeader } from "../components/AppHeader";
import { AppNav, type View } from "../components/AppNav";
import { GamblingBanner } from "../components/GamblingBanner";
import { FREEBETS_PATH, navigate, oddsHref, valueBetsHref } from "../routes";
import { useIsWide } from "../useMediaQuery";
import { ConversionControls } from "./ConversionControls";
import { Results } from "./Results";
import { readSettings, requestOf, settingsQuery, type Settings } from "./settings";
import { useConversions } from "./useConversions";
import { useWallet } from "./useWallet";
import { WalletCard as Wallet } from "./WalletCard";
import styles from "./FreebetsPage.module.css";

// The Freebets page, for accounts: the freebets held at each bookmaker (kept on the account), how to convert them
// (between bookmakers, or against the exchange) and the three best conversions with the bets to place. The
// settings live in the address, so that a reload or a shared link shows the same view.
export function FreebetsPage() {
  const wide = useIsWide();
  const wallet = useWallet();
  const [settings, setSettings] = useState<Settings>(() => readSettings(window.location.search));
  const holding = useMemo(() => ALL_BOOKMAKERS.filter((id) => (wallet.wallet[id] ?? 0) > 0), [wallet.wallet]);
  const request = requestOf(settings, holding);
  const conversions = useConversions(wallet.status === "ready" ? request : null, wallet.version);

  useEffect(() => {
    const query = settingsQuery(settings);
    window.history.replaceState(window.history.state, "", query ? `${FREEBETS_PATH}?${query}` : FREEBETS_PATH);
  }, [settings]);

  // The sports on offer for the settings: those of the last answer to them (the ticked ones do not narrow them).
  const eligible = conversions.answer && conversions.answered?.mode === (request?.mode ?? settings.mode) ? conversions.answer.eligibleSports : null;

  function changeView(view: View) {
    if (view === "value-bets") navigate(valueBetsHref);
    else if (view === "matches") navigate(oddsHref);
  }
  const nav = <AppNav view="freebets" onChange={changeView} placement={wide ? "header" : "bar"} />;
  const waiting = wallet.save === "pending" || wallet.save === "saving";

  return (
    <div className={wide ? styles.app : `${styles.app} ${styles.withBar}`}>
      <GamblingBanner sportsBetting />
      <AppHeader lastUpdated={conversions.updatedAt} refreshing={conversions.loading} failed={conversions.error !== null && conversions.answer === null} onRefresh={conversions.reload}>
        {wide && nav}
      </AppHeader>
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>Freebets</h1>
          <p className={styles.subtitle}>Turn your freebets into real money, between bookmakers or against the exchange.</p>
        </div>
        <div className={styles.stack}>
          <Wallet wallet={wallet} />
          <ConversionControls
            settings={settings}
            onChange={(change) => setSettings((current) => ({ ...current, ...change }))}
            wallet={wallet.wallet}
            holding={holding}
            bookmaker={request?.mode === "exchange" ? request.bookmaker : null}
            eligible={eligible}
          />
          <Results
            request={request}
            conversions={conversions}
            walletReady={wallet.status === "ready"}
            waiting={waiting}
            onSwitchToExchange={() => setSettings((current) => ({ ...current, mode: "exchange" }))}
          />
        </div>
      </main>
      <AppFooter />
      {!wide && nav}
    </div>
  );
}
