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
      title="Connexion"
      footer={
        <>
          Pas encore de compte ? <Link href={REGISTER_PATH}>Créer un compte</Link>
        </>
      }
    >
      <AuthForm
        fields={[
          { name: "email", label: "Adresse email", type: "email", autoComplete: "email" },
          { name: "password", label: "Mot de passe", type: "password", autoComplete: "current-password" },
        ]}
        submit="Se connecter"
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
            "Un nouvel email vient de partir."
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => resendVerification(unverified).then(() => setResent(true), () => {})}
            >
              Renvoyer l'email de confirmation
            </button>
          )}
        </p>
      )}
      <p className={styles.aside}>
        <Link href={FORGOT_PATH}>Mot de passe oublié ?</Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  return (
    <AuthLayout
      title="Créer un compte"
      intro="Un compte gratuit donne accès aux cotes, aux value bets et aux surebets."
      footer={
        <>
          Déjà inscrit ? <Link href={LOGIN_PATH}>Se connecter</Link>
        </>
      }
    >
      <AuthForm
        fields={[
          { name: "email", label: "Adresse email", type: "email", autoComplete: "email" },
          { name: "password", label: "Mot de passe", type: "password", autoComplete: "new-password", hint: PASSWORD_HINT, minLength: 12 },
        ]}
        submit="Créer mon compte"
        onSubmit={async ({ email, password }) => void (await register(email, password))}
        success={
          <Notice>
            Presque fini ! Si cette adresse est valide, un email de confirmation vient de lui être envoyé. Ouvrez le lien qu'il
            contient pour activer votre compte.
          </Notice>
        }
      />
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Mot de passe oublié"
      intro="Indiquez l'adresse de votre compte : nous vous y envoyons un lien pour en choisir un nouveau."
      footer={<Link href={LOGIN_PATH}>Retour à la connexion</Link>}
    >
      <AuthForm
        fields={[{ name: "email", label: "Adresse email", type: "email", autoComplete: "email" }]}
        submit="Envoyer le lien"
        onSubmit={async ({ email }) => void (await forgotPassword(email))}
        success={
          <Notice>Si un compte existe pour cette adresse, un email vient de lui être envoyé avec un lien valable une heure.</Notice>
        }
      />
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const token = tokenParam();
  return (
    <AuthLayout title="Nouveau mot de passe" footer={<Link href={LOGIN_PATH}>Retour à la connexion</Link>}>
      {token ? (
        <AuthForm
          fields={[{ name: "password", label: "Nouveau mot de passe", type: "password", autoComplete: "new-password", hint: PASSWORD_HINT, minLength: 12 }]}
          submit="Changer le mot de passe"
          onSubmit={async ({ password }) => void (await resetPassword(token, password))}
          success={
            <Notice>
              Mot de passe modifié. Vos autres appareils ont été déconnectés. <Link href={LOGIN_PATH}>Se connecter</Link>
            </Notice>
          }
        />
      ) : (
        <p role="alert" className={styles.error}>
          Ce lien est incomplet. <Link href={FORGOT_PATH}>Demander un nouveau lien</Link>
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
    <AuthLayout title="Confirmation de l'adresse email">
      {state === "working" && <p role="status">Vérification du lien…</p>}
      {state === "ok" && (
        <Notice>
          Adresse confirmée, votre compte est actif. <Link href={LOGIN_PATH}>Se connecter</Link>
        </Notice>
      )}
      {state === "failed" && (
        <p role="alert" className={styles.error}>
          Ce lien de confirmation est invalide ou a expiré. <Link href={LOGIN_PATH}>Se connecter</Link> pour en recevoir un nouveau.
        </p>
      )}
    </AuthLayout>
  );
}
