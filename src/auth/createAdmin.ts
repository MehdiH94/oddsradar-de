import "dotenv/config";
import { openAuthDb } from "./db";
import { hashPassword, passwordProblem } from "./password";
import { createUser, findUserByEmail, setRole } from "./store";
import { createInterface } from "node:readline/promises";

// npm run create-admin -- someone@example.com
// Makes that account an admin (creating it, already confirmed, when it does
// not exist). The only way to get the role: no route grants it.
async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: npm run create-admin -- <email>");
    process.exit(1);
  }
  const db = openAuthDb(process.env.AUTH_DB_PATH ?? "./data/auth.sqlite");
  const existing = findUserByEmail(db, email);
  if (existing) {
    setRole(db, existing.id, "admin");
    console.log(`${existing.email} is now an admin.`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question("Password for the new account: ");
  rl.close();
  const problem = passwordProblem(password, email);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const user = createUser(db, { email, passwordHash: await hashPassword(password), role: "admin", verified: true });
  console.log(`Admin ${user.email} created.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
