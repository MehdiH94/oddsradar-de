import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AuthError } from "./authApi";
import styles from "./AuthPages.module.css";

export interface Field {
  name: string;
  label: string;
  type: "email" | "password";
  autoComplete: "email" | "current-password" | "new-password";
  hint?: string;
  minLength?: number;
}

// A form that sends its fields to `onSubmit` and shows the server's message
// when it refuses. The errors are announced (role="alert"); the fields are
// named for the password managers (autocomplete). A password field has a
// button to show what was typed; it is hidden again when the form is sent,
// so the browser never offers to remember it as plain text.
export function AuthForm({
  fields,
  submit,
  onSubmit,
  success,
}: {
  fields: Field[];
  submit: string;
  // Throws an AuthError to show its message under the form; its `code` is
  // given to `onError` too.
  onSubmit: (values: Record<string, string>) => Promise<void>;
  // Replaces the form once the request went through.
  success?: ReactNode;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // The password fields currently shown in clear, by name.
  const [shown, setShown] = useState<Record<string, boolean>>({});

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setShown({});
    const form = new FormData(e.currentTarget);
    const values = Object.fromEntries(fields.map((f) => [f.name, String(form.get(f.name) ?? "")]));
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
      setDone(true);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Une erreur est survenue. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  if (done && success) return <>{success}</>;

  return (
    <form className={styles.form} onSubmit={handle} noValidate={false}>
      {fields.map((f) => {
        const inputId = `${id}-${f.name}`;
        const isPassword = f.type === "password";
        const visible = isPassword && shown[f.name] === true;
        const input = (
          <input
            id={inputId}
            name={f.name}
            type={visible ? "text" : f.type}
            autoComplete={f.autoComplete}
            required
            minLength={f.minLength}
            maxLength={f.type === "email" ? 254 : 128}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={f.hint ? `${inputId}-hint` : undefined}
          />
        );
        return (
          <div className={styles.field} key={f.name}>
            <label htmlFor={inputId}>{f.label}</label>
            {isPassword ? (
              <div className={styles.passwordWrap}>
                {input}
                <button
                  type="button"
                  className={styles.reveal}
                  aria-label="Afficher le mot de passe"
                  aria-pressed={visible}
                  aria-controls={inputId}
                  onClick={() => setShown((s) => ({ ...s, [f.name]: !visible }))}
                >
                  {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
                </button>
              </div>
            ) : (
              input
            )}
            {f.hint && (
              <span id={`${inputId}-hint`} className={styles.hint}>
                {f.hint}
              </span>
            )}
          </div>
        );
      })}
      <div role="alert" className={error ? styles.error : undefined}>
        {error}
      </div>
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy ? "Patientez…" : submit}
      </button>
    </form>
  );
}

export const PASSWORD_HINT = "12 caractères au minimum. Une phrase de passe fait très bien l'affaire.";
