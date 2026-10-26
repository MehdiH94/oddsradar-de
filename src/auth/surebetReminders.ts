import { AuthContext } from "./context";
import { mails } from "./mailer";
import { dueReminders, markReminded } from "./takenSurebets";

// Every minute in the web process (src/api/index.ts): the taken surebets
// whose match starts within the hour and whose account asked for it get their
// email, each once. A mail that fails is tried again the next minute, while
// the match has not started; never throws.
export async function runSurebetReminders(auth: AuthContext): Promise<number> {
  const now = auth.now();
  let sent = 0;
  let due;
  try {
    due = dueReminders(auth.db, now);
  } catch (err) {
    console.error("[reminders] could not read the reminders:", err);
    return 0;
  }
  for (const reminder of due) {
    try {
      const link = `${auth.publicUrl}/odds?match=${encodeURIComponent(reminder.eventId)}`;
      await auth.mailer.send(mails.surebetReminder(reminder.email, reminder.label, reminder.startTime, link));
      markReminded(auth.db, reminder.userId, reminder.key, now);
      sent++;
    } catch (err) {
      console.error(`[reminders] ${reminder.userId}: could not send the reminder:`, err);
    }
  }
  return sent;
}
