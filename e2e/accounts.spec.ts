import { expect, test } from "@playwright/test";
import { NEW_PASSWORD, SEEDED_USER } from "./fixtures";
import { createConfirmedAccount, linkIn, logIn, waitForMail } from "./helpers";

// Signing up, getting the password back, signing out. Everyone here starts
// signed out, and each spec makes the account it needs (a fresh address each
// time: the server's database lives for the whole run).
test.use({ storageState: { cookies: [], origins: [] } });

const newEmail = (name: string) => `${name}-${Date.now()}@example.com`;

test("a visitor signs up, confirms their address from the email, and signs in", async ({ page, request }) => {
  const email = newEmail("inscription");

  await page.goto("/signup");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await expect(page.getByRole("status")).toContainText("haben wir dir gerade eine Bestätigungs-E-Mail geschickt");

  // Not signed in until the address is confirmed.
  await logIn(page, email, NEW_PASSWORD);
  await expect(page.getByRole("button", { name: "Bestätigungs-E-Mail erneut senden" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // The link in the email confirms it.
  await page.goto(linkIn(await waitForMail(request, email, "Bestätige deine E-Mail-Adresse")));
  await expect(page.getByRole("status")).toContainText("Adresse bestätigt, dein Konto ist aktiv");

  await logIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/odds/);
  await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
});

test("a visitor who forgot their password chooses a new one from the email, and the old one stops working", async ({ page, request }) => {
  const email = newEmail("oubli");
  await createConfirmedAccount(request, email, NEW_PASSWORD);

  await page.goto("/forgot-password");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Link senden" }).click();
  await expect(page.getByRole("status")).toContainText("haben wir gerade eine E-Mail mit einem Link geschickt");

  const changed = "a brand new passphrase";
  await page.goto(linkIn(await waitForMail(request, email, "Setze dein Passwort zurück")));
  await page.getByLabel("Neues Passwort").fill(changed);
  await page.getByRole("button", { name: "Passwort ändern" }).click();
  await expect(page.getByRole("status")).toContainText("Passwort geändert");

  // The old password is refused, the new one signs in.
  await logIn(page, email, NEW_PASSWORD);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await logIn(page, email, changed);
  await expect(page).toHaveURL(/\/odds/);
});

test("signing out closes the session: the dashboard and the API are shut again", async ({ page }) => {
  await logIn(page, SEEDED_USER.email, SEEDED_USER.password);
  await expect(page).toHaveURL(/\/odds/);
  expect((await page.request.get("/api/events")).ok()).toBe(true);

  await page.getByRole("button", { name: "Abmelden" }).click();

  expect((await page.request.get("/api/events")).status()).toBe(401);
  await page.goto("/odds");
  await expect(page).toHaveURL(/\/login\?next=/);
});
