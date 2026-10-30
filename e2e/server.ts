import express from "express";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { openDb } from "../src/db/client";
import { openAuthDb } from "../src/auth/db";
import { createAuthContext } from "../src/auth/context";
import { Mail, Mailer } from "../src/auth/mailer";
import { hashPassword, ScryptCost } from "../src/auth/password";
import { createUser } from "../src/auth/store";
import { createServer } from "../src/api/server";
import { saveSitePromos } from "../src/promos/sitePromos";
import { BASE_URL, PORT, SEEDED_ADMIN, SEEDED_USER, SITE_PROMO } from "./fixtures";
import { seedOdds } from "./seed";

// The real API and the built dashboard (web/dist) on two throwaway databases,
// seeded (seed.ts), for the end-to-end specs. Nothing of src/ is replaced but
// the mailer: the emails are kept here and read back at /__e2e/mails, which
// exists only in this process.
//
// A cheap hash, so that the specs' logins stay fast.
const COST: ScryptCost = { N: 2 ** 10, r: 8, p: 1 };

const dir = path.join(__dirname, ".tmp");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const sent: Mail[] = [];
const mailer: Mailer = { send: async (mail) => void sent.push(mail) };

const db = openDb(path.join(dir, "coteradar.sqlite"));
seedOdds(db);

const authDb = openAuthDb(path.join(dir, "auth.sqlite"));
const auth = createAuthContext({ db: authDb, mailer, publicUrl: BASE_URL, cost: COST });
saveSitePromos(authDb, SITE_PROMO.bookmaker, [SITE_PROMO]);

async function main(): Promise<void> {
  createUser(authDb, { email: SEEDED_USER.email, passwordHash: await hashPassword(SEEDED_USER.password, COST), verified: true });

  createUser(authDb, { email: SEEDED_ADMIN.email, passwordHash: await hashPassword(SEEDED_ADMIN.password, COST), role: "admin", verified: true });

  const app = express();
  // The emails sent to an address, oldest first.
  app.get("/__e2e/mails", (req, res) => {
    const to = String(req.query.to ?? "").toLowerCase();
    res.json(sent.filter((mail) => mail.to.toLowerCase() === to));
  });
  app.use(createServer(db, {}, { auth }));
  app.listen(PORT, () => console.log(`[e2e] listening on ${BASE_URL}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
