import { useEffect, useState } from "react";
import { AuthLayout } from "./AuthLayout";
import { AuthForm, PASSWORD_HINT } from "./AuthForm";
import { AuthError, forgotPassword, register, resendVerification, resetPassword, verifyEmail } from "./authApi";
import { useAuth } from "./useAuth";
import { Link } from "../components/Link";
import { FORGOT_PATH, LOGIN_PATH, navigate, ODDS_PATH, REGISTER_PATH, safeNext } from "../routes";
import styles from "./AuthPages.module.css";

const search = () => window.location.search;
const tokenParam = () => new URLSearchParams(search()).get("token") ?? "";

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className={styles.notice}>
      {children}
    </p>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [unverified, setUnverified] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  return (
    <AuthLayout
      title="Anmelden"
      footer={
        <>
          Noch kein Konto? <Link href={REGISTER_PATH}>Konto erstellen</Link>
        </>
      }
    >
      <AuthForm
        fields={[
          { name: "email", label: "E-Mail-Adresse", type: "email", autoComplete: "email" },
          { name: "password", label: "Passwort", type: "password", autoComplete: "current-password" },
        ]}
        submit="Anmelden"
        onSubmit={async ({ email, password }) => {
          try {
            setUnverified(null);
            await login(email, password);
          } catch (err) {
            if (err instanceof AuthError && err.code === "email_not_verified") setUnverified(email);
            throw err;
          }
          navigate(safeNext(search()) ?? ODDS_PATH);
        }}
      />
      {unverified && (
        <p className={styles.notice}>
          {resent ? (
            "Eine neue E-Mail ist unterwegs."
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => resendVerification(unverified).then(() => setResent(true), () => {})}
            >
              Bestätigungs-E-Mail erneut senden
            </button>
          )}
        </p>
      )}
      <p className={styles.aside}>
        <Link href={FORGOT_PATH}>Passwort vergessen?</Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  return (
    <AuthLayout
      title="Konto erstellen"
      intro="Mit einem kostenlosen Konto bekommst du Zugang zu den Quoten, den Value Bets und den Surebets."
      footer={
        <>
          Schon ein Konto? <Link href={LOGIN_PATH}>Anmelden</Link>
        </>
      }
    >
      <AuthForm
        fields={[
          { name: "email", label: "E-Mail-Adresse", type: "email", autoComplete: "email" },
          { name: "password", label: "Passwort", type: "password", autoComplete: "new-password", hint: PASSWORD_HINT, minLength: 12 },
        ]}
        submit="Konto erstellen"
        onSubmit={async ({ email, password }) => void (await register(email, password))}
        success={
          <Notice>
            Fast geschafft! Wenn diese Adresse gültig ist, haben wir dir gerade eine Bestätigungs-E-Mail geschickt. Öffne den
            Link darin, um dein Konto zu aktivieren.
          </Notice>
        }
      />
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Passwort vergessen"
      intro="Gib die E-Mail-Adresse deines Kontos ein: Wir schicken dir einen Link, um ein neues Passwort zu wählen."
      footer={<Link href={LOGIN_PATH}>Zurück zur Anmeldung</Link>}
    >
      <AuthForm
        fields={[{ name: "email", label: "E-Mail-Adresse", type: "email", autoComplete: "email" }]}
        submit="Link senden"
        onSubmit={async ({ email }) => void (await forgotPassword(email))}
        success={
          <Notice>Wenn es zu dieser Adresse ein Konto gibt, haben wir gerade eine E-Mail mit einem Link geschickt, der eine Stunde gültig ist.</Notice>
        }
      />
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const token = tokenParam();
  return (
    <AuthLayout title="Neues Passwort" footer={<Link href={LOGIN_PATH}>Zurück zur Anmeldung</Link>}>
      {token ? (
        <AuthForm
          fields={[{ name: "password", label: "Neues Passwort", type: "password", autoComplete: "new-password", hint: PASSWORD_HINT, minLength: 12 }]}
          submit="Passwort ändern"
          onSubmit={async ({ password }) => void (await resetPassword(token, password))}
          success={
            <Notice>
              Passwort geändert. Deine anderen Geräte wurden abgemeldet. <Link href={LOGIN_PATH}>Anmelden</Link>
            </Notice>
          }
        />
      ) : (
        <p role="alert" className={styles.error}>
          Dieser Link ist unvollständig. <Link href={FORGOT_PATH}>Neuen Link anfordern</Link>
        </p>
      )}
    </AuthLayout>
  );
}

// The link in the confirmation email. The token is spent by a POST from this
// page, not by the link itself: mail scanners that open links would use it up.
export function VerifyEmailPage() {
  const [token] = useState(tokenParam);
  const [state, setState] = useState<"working" | "ok" | "failed">(token ? "working" : "failed");
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    verifyEmail(token).then(
      () => !cancelled && setState("ok"),
      () => !cancelled && setState("failed")
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthLayout title="E-Mail-Adresse bestätigen">
      {state === "working" && <p role="status">Link wird geprüft…</p>}
      {state === "ok" && (
        <Notice>
          Adresse bestätigt, dein Konto ist aktiv. <Link href={LOGIN_PATH}>Anmelden</Link>
        </Notice>
      )}
      {state === "failed" && (
        <p role="alert" className={styles.error}>
          Dieser Bestätigungslink ist ungültig oder abgelaufen. <Link href={LOGIN_PATH}>Melde dich an</Link>, um einen neuen zu bekommen.
        </p>
      )}
    </AuthLayout>
  );
}
