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

// The emails. French, plain text: nothing to render, nothing to block.
export const mails = {
  verifyEmail: (to: string, link: string): Mail => ({
    to,
    subject: "Confirmez votre adresse email · CoteRadar",
    text: `Bienvenue sur CoteRadar.\n\nPour activer votre compte, confirmez votre adresse en ouvrant ce lien (valable 24 h) :\n${link}\n\nSi vous n'avez pas créé de compte, ignorez ce message.`,
  }),
  resetPassword: (to: string, link: string): Mail => ({
    to,
    subject: "Réinitialisation de votre mot de passe · CoteRadar",
    text: `Vous avez demandé à réinitialiser votre mot de passe CoteRadar.\n\nOuvrez ce lien pour en choisir un nouveau (valable 1 h) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
  }),
  alreadyRegistered: (to: string, link: string): Mail => ({
    to,
    subject: "Vous avez déjà un compte · CoteRadar",
    text: `Quelqu'un (peut-être vous) a essayé de créer un compte CoteRadar avec cette adresse, qui en a déjà un.\n\nMot de passe oublié ? Réinitialisez-le ici :\n${link}\n\nSi ce n'était pas vous, ignorez ce message.`,
  }),
};
