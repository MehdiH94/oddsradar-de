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

  await page.goto("/inscription");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByRole("status")).toContainText("un email de confirmation vient de lui être envoyé");

  // Not signed in until the address is confirmed.
  await logIn(page, email, NEW_PASSWORD);
  await expect(page.getByRole("button", { name: "Renvoyer l'email de confirmation" })).toBeVisible();
  await expect(page).toHaveURL(/\/connexion/);

  // The link in the email confirms it.
  await page.goto(linkIn(await waitForMail(request, email, "Confirmez")));
  await expect(page.getByRole("status")).toContainText("Adresse confirmée, votre compte est actif");

  await logIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/cotes/);
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
});

test("a visitor who forgot their password chooses a new one from the email, and the old one stops working", async ({ page, request }) => {
  const email = newEmail("oubli");
  await createConfirmedAccount(request, email, NEW_PASSWORD);

  await page.goto("/mot-de-passe-oublie");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByRole("status")).toContainText("un email vient de lui être envoyé");

  const changed = "a brand new passphrase";
  await page.goto(linkIn(await waitForMail(request, email, "Réinitialisation")));
  await page.getByLabel("Nouveau mot de passe").fill(changed);
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();
  await expect(page.getByRole("status")).toContainText("Mot de passe modifié");

  // The old password is refused, the new one signs in.
  await logIn(page, email, NEW_PASSWORD);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/connexion/);

  await logIn(page, email, changed);
  await expect(page).toHaveURL(/\/cotes/);
});

test("signing out closes the session: the dashboard and the API are shut again", async ({ page }) => {
  await logIn(page, SEEDED_USER.email, SEEDED_USER.password);
  await expect(page).toHaveURL(/\/cotes/);
  expect((await page.request.get("/api/events")).ok()).toBe(true);

  await page.getByRole("button", { name: "Se déconnecter" }).click();

  expect((await page.request.get("/api/events")).status()).toBe(401);
  await page.goto("/cotes");
  await expect(page).toHaveURL(/\/connexion\?next=/);
});
