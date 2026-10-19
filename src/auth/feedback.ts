import { DatabaseSync } from "node:sqlite";

// What the beta's testers tell the team, from the button in the site's header
// (web/src/components/FeedbackButton.tsx), and how the administration page
// lists it.

export const MAX_FEEDBACK_LENGTH = 2000;
// The page it was sent from: a path of the site, as the client gives it.
const MAX_PAGE_LENGTH = 200;

export interface NewFeedback {
  message: string;
  page: string | null;
}

export interface FeedbackItem {
  id: number;
  email: string;
  message: string;
  page: string | null;
  createdAt: string;
  doneAt: string | null;
}

// The body of a POST, or null when it is not feedback: an empty or too long
// message is refused, a page that is not a path of the site is dropped.
export function parseFeedback(input: unknown): NewFeedback | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { message, page } = input as Record<string, unknown>;
  if (typeof message !== "string") return null;
  const text = message.trim();
  if (text.length === 0 || text.length > MAX_FEEDBACK_LENGTH) return null;
  const path = typeof page === "string" && page.startsWith("/") && page.length <= MAX_PAGE_LENGTH ? page : null;
  return { message: text, page: path };
}

export function saveFeedback(db: DatabaseSync, userId: string, feedback: NewFeedback, now: Date): void {
  db.prepare("INSERT INTO feedback (user_id, message, page, created_at) VALUES (?, ?, ?, ?)").run(
    userId,
    feedback.message,
    feedback.page,
    now.toISOString()
  );
}

// The newest first.
export function listFeedback(db: DatabaseSync): FeedbackItem[] {
  return db
    .prepare(
      `SELECT feedback.id, users.email, feedback.message, feedback.page, feedback.created_at AS createdAt, feedback.done_at AS doneAt
       FROM feedback JOIN users ON users.id = feedback.user_id
       ORDER BY feedback.created_at DESC, feedback.id DESC`
    )
    .all() as unknown as FeedbackItem[];
}

// Marks it handled, or not; false when there is no such feedback.
export function setFeedbackDone(db: DatabaseSync, id: number, done: boolean, now: Date): boolean {
  const result = db.prepare("UPDATE feedback SET done_at = ? WHERE id = ?").run(done ? now.toISOString() : null, id);
  return Number(result.changes) > 0;
}
