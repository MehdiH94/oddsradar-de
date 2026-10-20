import { announceUnauthorized } from "./auth/session";

// The longest message the server takes (src/auth/feedback.ts).
export const MAX_FEEDBACK_LENGTH = 2000;

// Sends a tester's message, with the page it was written on. Null when it was
// stored, else what to tell them.
export async function sendFeedback(message: string, page: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, page }),
    });
  } catch {
    return "Keine Verbindung. Prüf dein Netzwerk und versuch es noch einmal.";
  }
  if (res.ok) return null;
  if (res.status === 401) announceUnauthorized();
  const data = await res.json().catch(() => ({}));
  return data.message ?? "Etwas ist schiefgelaufen. Versuch es gleich noch einmal.";
}
