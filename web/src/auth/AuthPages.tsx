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
      title="Log in"
      footer={
        <>
          No account yet? <Link href={REGISTER_PATH}>Create an account</Link>
        </>
      }
    >
      <AuthForm
        fields={[
          { name: "email", label: "Email address", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
        submit="Log in"
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
            "A new email is on its way."
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => resendVerification(unverified).then(() => setResent(true), () => {})}
            >
              Send the confirmation email again
            </button>
          )}
        </p>
      )}
      <p className={styles.aside}>
        <Link href={FORGOT_PATH}>Forgot your password?</Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  return (
    <AuthLayout
      title="Create an account"
      intro="A free account gives access to the odds, the value bets and the surebets."
      footer={
        <>
          Already have an account? <Link href={LOGIN_PATH}>Log in</Link>
        </>
      }
    >
      <AuthForm
        fields={[
          { name: "email", label: "Email address", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: PASSWORD_HINT, minLength: 12 },
        ]}
        submit="Create my account"
        onSubmit={async ({ email, password }) => void (await register(email, password))}
        success={
          <Notice>
            Almost done! If this address is valid, a confirmation email has just been sent to it. Open the link it contains to
            activate your account.
          </Notice>
        }
      />
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Forgot password"
      intro="Enter your account's address: we will send you a link to choose a new one."
      footer={<Link href={LOGIN_PATH}>Back to log in</Link>}
    >
      <AuthForm
        fields={[{ name: "email", label: "Email address", type: "email", autoComplete: "email" }]}
        submit="Send the link"
        onSubmit={async ({ email }) => void (await forgotPassword(email))}
        success={
          <Notice>If an account exists for this address, an email has just been sent to it with a link valid for one hour.</Notice>
        }
      />
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const token = tokenParam();
  return (
    <AuthLayout title="New password" footer={<Link href={LOGIN_PATH}>Back to log in</Link>}>
      {token ? (
        <AuthForm
          fields={[{ name: "password", label: "New password", type: "password", autoComplete: "new-password", hint: PASSWORD_HINT, minLength: 12 }]}
          submit="Change the password"
          onSubmit={async ({ password }) => void (await resetPassword(token, password))}
          success={
            <Notice>
              Password changed. Your other devices have been logged out. <Link href={LOGIN_PATH}>Log in</Link>
            </Notice>
          }
        />
      ) : (
        <p role="alert" className={styles.error}>
          This link is incomplete. <Link href={FORGOT_PATH}>Ask for a new link</Link>
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
    <AuthLayout title="Email address confirmation">
      {state === "working" && <p role="status">Checking the link…</p>}
      {state === "ok" && (
        <Notice>
          Address confirmed, your account is active. <Link href={LOGIN_PATH}>Log in</Link>
        </Notice>
      )}
      {state === "failed" && (
        <p role="alert" className={styles.error}>
          This confirmation link is invalid or has expired. <Link href={LOGIN_PATH}>Log in</Link> to get a new one.
        </p>
      )}
    </AuthLayout>
  );
}
