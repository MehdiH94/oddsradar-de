import { useId, useState, type FormEvent } from "react";
import { MessageSquare } from "lucide-react";
import { MAX_FEEDBACK_LENGTH, sendFeedback } from "../feedback";
import { Sheet } from "./Sheet";
import styles from "./FeedbackButton.module.css";

// The beta's testers tell the team what is wrong or missing: a message, sent
// with the page it was written on, which the administration lists (its
// Feedback tab). `className` is the header's icon button.
export function FeedbackButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fieldId = useId();

  function show() {
    setSent(false);
    setError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) {
      setError("Write a message first.");
      return;
    }
    setSending(true);
    setError(null);
    const failure = await sendFeedback(text, window.location.pathname + window.location.search);
    setSending(false);
    if (failure) {
      setError(failure);
      return;
    }
    setMessage("");
    setSent(true);
  }

  return (
    <>
      <button type="button" className={className} onClick={show} aria-label="Send feedback" aria-haspopup="dialog">
        <MessageSquare size={18} aria-hidden="true" />
      </button>
      <Sheet id="feedback-sheet" title="Send feedback" open={open} onClose={() => setOpen(false)}>
        {sent ? (
          <div className={styles.thanks}>
            <p role="status">Thank you! Your message has been sent to the team.</p>
            <button type="button" className={styles.send} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label htmlFor={fieldId} className={styles.label}>
              A bug, a missing bookmaker or match, an idea: tell us.
            </label>
            <textarea
              id={fieldId}
              className={styles.field}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MAX_FEEDBACK_LENGTH}
              rows={6}
              required
            />
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <button type="submit" className={styles.send} disabled={sending}>
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        )}
      </Sheet>
    </>
  );
}
