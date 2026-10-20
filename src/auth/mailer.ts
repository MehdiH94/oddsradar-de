import { APP_NAME } from "../brand";
import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// Writes the email to the log instead of sending it: development, and the
// only way to read a link when no SMTP server is set.
export const logMailer: Mailer = {
  async send({ to, subject, text }) {
    console.log(`[mail] to=${to} subject=${subject}\n${text}`);
  },
};

export interface SmtpSettings {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
}

export function smtpMailer({ host, port, user, password, from }: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport({
    host,
    port,
    // Port 465 is TLS from the start; the others upgrade with STARTTLS, which
    // we require rather than let it fall back to clear text.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: user ? { user, pass: password } : undefined,
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

// SMTP_HOST and SMTP_FROM set: SMTP. Otherwise the log, which is refused in
// production: nobody would receive their link.
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  if (env.SMTP_HOST && env.SMTP_FROM) {
    return smtpMailer({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? "587"),
      user: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
      from: env.SMTP_FROM,
    });
  }
  if (env.NODE_ENV === "production") {
    throw new Error("SMTP_HOST and SMTP_FROM must be set in production: accounts could not confirm their email");
  }
  return logMailer;
}

// The emails. German, plain text: nothing to render, nothing to block.
export const mails = {
  verifyEmail: (to: string, link: string): Mail => ({
    to,
    subject: `Bestätige deine E-Mail-Adresse · ${APP_NAME}`,
    text: `Willkommen bei ${APP_NAME}.\n\nUm dein Konto zu aktivieren, bestätige deine Adresse über diesen Link (24 Stunden gültig):\n${link}\n\nWenn du kein Konto erstellt hast, ignoriere diese Nachricht.`,
  }),
  resetPassword: (to: string, link: string): Mail => ({
    to,
    subject: `Setze dein Passwort zurück · ${APP_NAME}`,
    text: `Du hast angefordert, dein ${APP_NAME}-Passwort zurückzusetzen.\n\nÖffne diesen Link, um ein neues zu wählen (1 Stunde gültig):\n${link}\n\nWenn du das nicht angefordert hast, ignoriere diese Nachricht: Dein Passwort bleibt unverändert.`,
  }),
  alreadyRegistered: (to: string, link: string): Mail => ({
    to,
    subject: `Du hast bereits ein Konto · ${APP_NAME}`,
    text: `Jemand (vielleicht du) hat versucht, mit dieser Adresse ein ${APP_NAME}-Konto zu erstellen, aber es gibt schon eins.\n\nPasswort vergessen? Hier kannst du es zurücksetzen:\n${link}\n\nWenn du das nicht warst, ignoriere diese Nachricht.`,
  }),
};
