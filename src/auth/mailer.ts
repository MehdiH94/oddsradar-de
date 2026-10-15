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

// The emails. English, plain text: nothing to render, nothing to block.
export const mails = {
  verifyEmail: (to: string, link: string): Mail => ({
    to,
    subject: `Confirm your email address · ${APP_NAME}`,
    text: `Welcome to ${APP_NAME}.\n\nTo activate your account, confirm your address by opening this link (valid for 24 hours):\n${link}\n\nIf you did not create an account, ignore this message.`,
  }),
  resetPassword: (to: string, link: string): Mail => ({
    to,
    subject: `Reset your password · ${APP_NAME}`,
    text: `You asked to reset your ${APP_NAME} password.\n\nOpen this link to choose a new one (valid for 1 hour):\n${link}\n\nIf you did not ask for this, ignore this message: your password stays the same.`,
  }),
  alreadyRegistered: (to: string, link: string): Mail => ({
    to,
    subject: `You already have an account · ${APP_NAME}`,
    text: `Someone (perhaps you) tried to create a ${APP_NAME} account with this address, which already has one.\n\nForgot your password? Reset it here:\n${link}\n\nIf it was not you, ignore this message.`,
  }),
};
