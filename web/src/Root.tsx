import { lazy, Suspense, useEffect, useState } from "react";
import { loadDashboard } from "./dashboard";
import { loadPreferences, type Preferences } from "./preferences";
import { HomePage } from "./HomePage";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/useAuth";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "./auth/AuthPages";
import {
  ADMIN_PATH,
  currentPath,
  FORGOT_PATH,
  FREEBETS_PATH,
  LOGIN_PATH,
  loginHref,
  navigate,
  ODDS_PATH,
  onPathChange,
  REGISTER_PATH,
  RESET_PATH,
  safeNext,
  VERIFY_PATH,
} from "./routes";
import { APP_NAME } from "./brand";
import { Skeleton } from "./components/StatusViews";
import styles from "./Root.module.css";

// The dashboard's code comes in on its own (dashboard.ts).
const App = lazy(() => loadDashboard().then((module) => ({ default: module.App })));
// The administration, which only admins ever load.
const AdminPage = lazy(() => import("./admin/AdminPage").then((module) => ({ default: module.AdminPage })));
// The Freebets page, a chunk of its own too.
const FreebetsPage = lazy(() => import("./freebets/FreebetsPage").then((module) => ({ default: module.FreebetsPage })));

export const HOME_TITLE = `${APP_NAME} · Odds comparison and value bets`;
export const ODDS_TITLE = `Odds and value bets · ${APP_NAME}`;
export const FREEBETS_TITLE = `Freebets · ${APP_NAME}`;

const PAGE_TITLES: Record<string, string> = {
  [ODDS_PATH]: ODDS_TITLE,
  [LOGIN_PATH]: `Log in · ${APP_NAME}`,
  [REGISTER_PATH]: `Create an account · ${APP_NAME}`,
  [FORGOT_PATH]: `Forgot password · ${APP_NAME}`,
  [RESET_PATH]: `New password · ${APP_NAME}`,
  [VERIFY_PATH]: `Email confirmation · ${APP_NAME}`,
  [ADMIN_PATH]: `Administration · ${APP_NAME}`,
  [FREEBETS_PATH]: FREEBETS_TITLE,
};

const loadingView = (
  <main className={styles.loading} aria-busy="true">
    <Skeleton />
  </main>
);

// Which page the address asks for: the dashboard at ODDS_PATH (and the old
// dashboard links at "/", see currentPath), the Freebets page, the account pages, the home
// anywhere else. There is no router library: a few pages, and App keeps its
// own state in the query string with window.history.
//
// The dashboard is for accounts: someone signed out is sent to the login page,
// which brings them back (?next=). The server enforces the same on /api; this
// only spares them a page of errors.
export function Root() {
  return (
    <AuthProvider>
      <Pages />
    </AuthProvider>
  );
}

// The dashboard opens on the account's saved filters (an address that names
// none of them gets those), so they are fetched before it is drawn: it reads
// its initial state once. The fetch runs while the dashboard's code comes in,
// and never fails the page: without an answer it opens on the address's or the
// default filters.
function Dashboard() {
  const [loaded, setLoaded] = useState<{ preferences: Preferences | null } | null>(null);
  useEffect(() => {
    // The code comes in meanwhile, rather than after the answer.
    void loadDashboard();
    let cancelled = false;
    loadPreferences().then((preferences) => {
      if (!cancelled) setLoaded({ preferences });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!loaded) return loadingView;
  return (
    <Suspense fallback={loadingView}>
      <App preferences={loaded.preferences} />
    </Suspense>
  );
}

function Pages() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => onPathChange(() => setPath(currentPath())), []);
  const { status, user } = useAuth();

  const onOdds = path === ODDS_PATH;
  const onAdmin = path === ADMIN_PATH;
  const onFreebets = path === FREEBETS_PATH;
  const signInOrUp = path === LOGIN_PATH || path === REGISTER_PATH;
  useEffect(() => {
    document.title = PAGE_TITLES[path] ?? HOME_TITLE;
  }, [path]);

  const mustLogIn = (onOdds || onAdmin || onFreebets) && status === "anonymous";
  const alreadyIn = signInOrUp && status === "authenticated";
  // The administration is for admins: anyone else signed in is sent to the odds
  // (the server refuses them its data anyway).
  const notAdmin = onAdmin && status === "authenticated" && user?.role !== "admin";
  useEffect(() => {
    if (mustLogIn) navigate(loginHref(window.location.pathname + window.location.search + window.location.hash));
    else if (alreadyIn) navigate(safeNext(window.location.search) ?? ODDS_PATH);
    else if (notAdmin) navigate(ODDS_PATH);
  }, [mustLogIn, alreadyIn, notAdmin]);

  if (onOdds) {
    if (status !== "authenticated") return loadingView;
    return <Dashboard />;
  }
  if (onFreebets) {
    if (status !== "authenticated") return loadingView;
    return (
      <Suspense fallback={loadingView}>
        <FreebetsPage />
      </Suspense>
    );
  }
  if (onAdmin) {
    if (status !== "authenticated" || user?.role !== "admin") return loadingView;
    return (
      <Suspense fallback={loadingView}>
        <AdminPage />
      </Suspense>
    );
  }
  if (signInOrUp && status === "loading") return loadingView;
  switch (path) {
    case LOGIN_PATH:
      return <LoginPage />;
    case REGISTER_PATH:
      return <RegisterPage />;
    case FORGOT_PATH:
      return <ForgotPasswordPage />;
    case RESET_PATH:
      return <ResetPasswordPage />;
    case VERIFY_PATH:
      return <VerifyEmailPage />;
    default:
      return <HomePage />;
  }
}
