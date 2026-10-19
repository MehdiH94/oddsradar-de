import { useCallback, useEffect, useState } from "react";
import { APP_NAME } from "../brand";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Logo } from "../components/Logo";
import { ODDS_PATH } from "../routes";
import { BOOKMAKER_BRANDING } from "../bookmakers";
import {
  AdminError,
  fetchAdminBookmakers,
  fetchAdminFeedback,
  fetchAdminUsers,
  updateAdminFeedback,
  updateAdminUser,
  type AdminBookmaker,
  type AdminFeedback,
  type AdminUser,
  type AdminUserChange,
} from "./adminApi";
import styles from "./AdminPage.module.css";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "short" });
const formatDate = (iso: string | null) => (iso ? DATE_FORMAT.format(new Date(iso)) : "—");

// The administration, for accounts with the admin role (the server answers 403
// to the others; Root only spares them the page). Three tabs: the users (who
// they are, whether the address is confirmed, whether they pay, and the two
// things an admin does with an account -- block it, make it admin), the
// bookmakers' health (whether each one still gives odds), and what the
// testers wrote (the header's Feedback button).
type Tab = "users" | "bookmakers" | "feedback";
const TABS: [Tab, string][] = [
  ["users", "Users"],
  ["bookmakers", "Bookmakers"],
  ["feedback", "Feedback"],
];

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href={ODDS_PATH} aria-label={`${APP_NAME}, back to the odds`}>
          <Logo className={styles.logo} />
          <span className={styles.name}>{APP_NAME}</span>
        </a>
        <a className={styles.back} href={ODDS_PATH}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to the odds
        </a>
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>
          <ShieldCheck size={22} aria-hidden="true" /> Administration
        </h1>
        <div role="tablist" aria-label="Sections" className={styles.tabs}>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`admin-${id}`}
              id={`tab-${id}`}
              className={styles.tab}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <section id={`admin-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === "users" ? <UsersTab /> : tab === "bookmakers" ? <BookmakersTab /> : <FeedbackTab />}
        </section>
      </main>
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The account an action is on its way for.
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    return fetchAdminUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof AdminError ? err.message : "Something went wrong."));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function change(target: AdminUser, change: AdminUserChange, question: string | null) {
    if (question && !window.confirm(question)) return;
    setBusyId(target.id);
    setError(null);
    try {
      const updated = await updateAdminUser(target.id, change);
      setUsers((list) => list && list.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  if (!users) {
    return error ? (
      <p role="alert" className={styles.error}>
        {error}{" "}
        <button type="button" className={styles.linkButton} onClick={() => void load()}>
          Try again
        </button>
      </p>
    ) : (
      <p aria-busy="true" className={styles.muted}>
        Loading the users…
      </p>
    );
  }

  return (
    <>
      <p className={styles.muted}>
        {users.length} account{users.length === 1 ? "" : "s"}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className="visually-hidden">The accounts</caption>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Account</th>
              <th scope="col">Subscription</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Signed up</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const own = u.id === me?.id;
              const blocked = u.status === "disabled";
              const busy = busyId === u.id;
              return (
                <tr key={u.id}>
                  <th scope="row" className={styles.email}>
                    {u.email}
                    {own && <span className={styles.you}> (you)</span>}
                  </th>
                  <td>{u.emailVerifiedAt ? "Confirmed" : "Not confirmed"}</td>
                  <td>{u.subscriptionStatus === "active" ? "Subscribed" : "No subscription"}</td>
                  <td>{u.role === "admin" ? "Admin" : "User"}</td>
                  <td>
                    <span className={blocked ? styles.blocked : styles.active}>{blocked ? "Blocked" : "Active"}</span>
                  </td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.action}
                        disabled={own || busy}
                        onClick={() =>
                          change(u, { status: blocked ? "active" : "disabled" }, blocked ? null : `Block ${u.email}? This account will be logged out and will no longer be able to log in.`)
                        }
                      >
                        {blocked ? "Unblock" : "Block"}
                        <span className="visually-hidden"> {u.email}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.action}
                        disabled={own || busy}
                        onClick={() =>
                          change(
                            u,
                            { role: u.role === "admin" ? "user" : "admin" },
                            u.role === "admin" ? null : `Make ${u.email} an administrator? This account will have access to this page.`
                          )
                        }
                      >
                        {u.role === "admin" ? "Remove admin" : "Make admin"}
                        <span className="visually-hidden"> {u.email}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });
const formatTime = (iso: string | null) => (iso ? TIME_FORMAT.format(new Date(iso)) : "never");
const HEALTH_LABELS: Record<AdminBookmaker["health"], string> = {
  ok: "OK",
  failing: "Failing",
  empty: "No match",
  down: "Down",
};

// Each bookmaker's last read: whether it still gives odds, how many matches,
// and the last error. "Down" is no match for 30 minutes, which the
// administrators' Discord channel is told about (src/alerts/health.ts).
function BookmakersTab() {
  const [bookmakers, setBookmakers] = useState<AdminBookmaker[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    return fetchAdminBookmakers()
      .then(setBookmakers)
      .catch((err) => setError(err instanceof AdminError ? err.message : "Something went wrong."));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!bookmakers) {
    return error ? (
      <p role="alert" className={styles.error}>
        {error}{" "}
        <button type="button" className={styles.linkButton} onClick={() => void load()}>
          Try again
        </button>
      </p>
    ) : (
      <p aria-busy="true" className={styles.muted}>
        Loading the bookmakers…
      </p>
    );
  }

  const down = bookmakers.filter((b) => b.health === "down").length;
  return (
    <>
      <p className={styles.muted}>
        {bookmakers.length === 0
          ? "No read yet: the worker records each bookmaker at its next cycle."
          : down === 0
            ? "Every bookmaker gives odds."
            : `${down} bookmaker${down === 1 ? "" : "s"} down.`}{" "}
        <button type="button" className={styles.linkButton} onClick={() => void load()}>
          Refresh
        </button>
      </p>
      {bookmakers.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="visually-hidden">The bookmakers' last reads</caption>
            <thead>
              <tr>
                <th scope="col">Bookmaker</th>
                <th scope="col">Status</th>
                <th scope="col">Last read</th>
                <th scope="col">Matches</th>
                <th scope="col">Last good read</th>
                <th scope="col">Last error</th>
              </tr>
            </thead>
            <tbody>
              {bookmakers.map((b) => (
                <tr key={b.bookmaker}>
                  <th scope="row" className={styles.email}>
                    {BOOKMAKER_BRANDING[b.bookmaker]?.name ?? b.bookmaker}
                  </th>
                  <td>
                    <span className={b.health === "ok" ? styles.active : b.health === "down" ? styles.blocked : styles.warning}>
                      {HEALTH_LABELS[b.health]}
                    </span>
                  </td>
                  <td>{formatTime(b.lastReadAt)}</td>
                  <td>{b.lastEvents ?? "—"}</td>
                  <td>
                    {formatTime(b.lastGoodAt)}
                    {b.lastGoodEvents !== null && b.health !== "ok" && <span className={styles.you}> ({b.lastGoodEvents} matches)</span>}
                  </td>
                  <td className={styles.errorCell}>{b.lastError ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// What the testers wrote, the newest first: who, when, from which page. An
// admin marks a message handled once it is dealt with; the open ones are
// counted at the top.
function FeedbackTab() {
  const [feedback, setFeedback] = useState<AdminFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setError(null);
    return fetchAdminFeedback()
      .then(setFeedback)
      .catch((err) => setError(err instanceof AdminError ? err.message : "Something went wrong."));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(item: AdminFeedback) {
    setBusyId(item.id);
    setError(null);
    try {
      const updated = await updateAdminFeedback(item.id, item.doneAt === null);
      setFeedback((list) => list && list.map((f) => (f.id === updated.id ? updated : f)));
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  if (!feedback) {
    return error ? (
      <p role="alert" className={styles.error}>
        {error}{" "}
        <button type="button" className={styles.linkButton} onClick={() => void load()}>
          Try again
        </button>
      </p>
    ) : (
      <p aria-busy="true" className={styles.muted}>
        Loading the feedback…
      </p>
    );
  }

  const open = feedback.filter((f) => f.doneAt === null).length;
  return (
    <>
      <p className={styles.muted}>
        {feedback.length === 0 ? "No feedback yet." : `${open} open message${open === 1 ? "" : "s"}, ${feedback.length} in all.`}{" "}
        <button type="button" className={styles.linkButton} onClick={() => void load()}>
          Refresh
        </button>
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {feedback.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="visually-hidden">The testers' feedback</caption>
            <thead>
              <tr>
                <th scope="col">Sent</th>
                <th scope="col">From</th>
                <th scope="col">Message</th>
                <th scope="col">Page</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f) => (
                <tr key={f.id}>
                  <td>{formatTime(f.createdAt)}</td>
                  <th scope="row" className={styles.email}>
                    {f.email}
                  </th>
                  <td className={styles.message}>{f.message}</td>
                  <td>{f.page ?? "—"}</td>
                  <td>
                    <button type="button" className={styles.action} disabled={busyId === f.id} onClick={() => void toggle(f)}>
                      {f.doneAt === null ? "Mark done" : "Reopen"}
                      <span className="visually-hidden"> the message of {f.email}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
