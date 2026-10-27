import { AuthContext } from "./context";
import { mails } from "./mailer";
import { duePromoReminders, markPromosReminded } from "./promos";

// Every 10 minutes in the web process (src/api/index.ts): each account whose
// open promos end within a day gets one e-mail listing them, each promo once
// (the owner, 26/10/2026: "ne pas rater les promos"). A mail that fails is
// tried again next time, while the promo has not ended; never throws.
export async function runPromoReminders(auth: AuthContext): Promise<number> {
  const now = auth.now();
  let sent = 0;
  let due;
  try {
    due = duePromoReminders(auth.db, now);
  } catch (err) {
    console.error("[promo-reminders] could not read the reminders:", err);
    return 0;
  }
  for (const reminder of due) {
    try {
      await auth.mailer.send(mails.promoReminder(reminder.email, reminder.promos, `${auth.publicUrl}/promos`));
      markPromosReminded(auth.db, reminder.userId, reminder.promos.map((p) => p.id), now);
      sent++;
    } catch (err) {
      console.error(`[promo-reminders] ${reminder.userId}: could not send the reminder:`, err);
    }
  }
  return sent;
}
