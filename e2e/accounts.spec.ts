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
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByRole("status")).toContainText("a confirmation email has just been sent to it");

  // Not signed in until the address is confirmed.
  await logIn(page, email, NEW_PASSWORD);
  await expect(page.getByRole("button", { name: "Send the confirmation email again" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // The link in the email confirms it.
  await page.goto(linkIn(await waitForMail(request, email, "Confirm your email")));
  await expect(page.getByRole("status")).toContainText("Address confirmed, your account is active");

  await logIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/odds/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});

test("a visitor who forgot their password chooses a new one from the email, and the old one stops working", async ({ page, request }) => {
  const email = newEmail("oubli");
  await createConfirmedAccount(request, email, NEW_PASSWORD);

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText("an email has just been sent to it");

  const changed = "a brand new passphrase";
  await page.goto(linkIn(await waitForMail(request, email, "Reset your password")));
  await page.getByLabel("New password").fill(changed);
  await page.getByRole("button", { name: "Change the password" }).click();
  await expect(page.getByRole("status")).toContainText("Password changed");

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

  await page.getByRole("button", { name: "Log out" }).click();

  expect((await page.request.get("/api/events")).status()).toBe(401);
  await page.goto("/odds");
  await expect(page).toHaveURL(/\/login\?next=/);
});
