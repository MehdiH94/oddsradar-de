import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Logo } from "../components/Logo";
import { ODDS_PATH } from "../routes";
import { AdminError, fetchAdminUsers, updateAdminUser, type AdminUser, type AdminUserChange } from "./adminApi";
import styles from "./AdminPage.module.css";

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });
const formatDate = (iso: string | null) => (iso ? DATE_FORMAT.format(new Date(iso)) : "—");

// The administration, for accounts with the admin role (the server answers 403
// to the others; Root only spares them the page). One tab for now, the
// users: who they are, whether the address is confirmed, whether they pay,
// and the two things an admin does with an account -- block it, make it admin.
export function AdminPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href={ODDS_PATH} aria-label="CoteRadar, retour aux cotes">
          <Logo className={styles.logo} />
          <span className={styles.name}>CoteRadar</span>
        </a>
        <a className={styles.back} href={ODDS_PATH}>
          <ArrowLeft size={16} aria-hidden="true" /> Retour aux cotes
        </a>
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>
          <ShieldCheck size={22} aria-hidden="true" /> Administration
        </h1>
        <div role="tablist" aria-label="Sections" className={styles.tabs}>
          <button type="button" role="tab" aria-selected="true" aria-controls="admin-users" id="tab-users" className={styles.tab}>
            Utilisateurs
          </button>
        </div>
        <section id="admin-users" role="tabpanel" aria-labelledby="tab-users">
          <UsersTab />
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
      .catch((err) => setError(err instanceof AdminError ? err.message : "Une erreur est survenue."));
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
      setError(err instanceof AdminError ? err.message : "Une erreur est survenue.");
    } finally {
      setBusyId(null);
    }
  }

  if (!users) {
    return error ? (
      <p role="alert" className={styles.error}>
        {error}{" "}
        <button type="button" className={styles.linkButton} onClick={() => void load()}>
          Réessayer
        </button>
      </p>
    ) : (
      <p aria-busy="true" className={styles.muted}>
        Chargement des utilisateurs…
      </p>
    );
  }

  return (
    <>
      <p className={styles.muted}>
        {users.length} compte{users.length > 1 ? "s" : ""}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className="visually-hidden">Les comptes</caption>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Compte</th>
              <th scope="col">Abonnement</th>
              <th scope="col">Rôle</th>
              <th scope="col">Statut</th>
              <th scope="col">Inscrit le</th>
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
                    {own && <span className={styles.you}> (vous)</span>}
                  </th>
                  <td>{u.emailVerifiedAt ? "Validé" : "Non validé"}</td>
                  <td>{u.subscriptionStatus === "active" ? "Abonné" : "Aucun abonnement"}</td>
                  <td>{u.role === "admin" ? "Admin" : "Utilisateur"}</td>
                  <td>
                    <span className={blocked ? styles.blocked : styles.active}>{blocked ? "Bloqué" : "Actif"}</span>
                  </td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.action}
                        disabled={own || busy}
                        onClick={() =>
                          change(u, { status: blocked ? "active" : "disabled" }, blocked ? null : `Bloquer ${u.email} ? Ce compte sera déconnecté et ne pourra plus se connecter.`)
                        }
                      >
                        {blocked ? "Débloquer" : "Bloquer"}
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
                            u.role === "admin" ? null : `Nommer ${u.email} administrateur ? Ce compte aura accès à cette page.`
                          )
                        }
                      >
                        {u.role === "admin" ? "Retirer admin" : "Nommer admin"}
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
