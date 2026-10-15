import { expect, test } from "@playwright/test";
import { NEW_PASSWORD, SEEDED_ADMIN, SEEDED_USER } from "./fixtures";
import { createConfirmedAccount, logIn } from "./helpers";

// The administration page: who gets in, and what an admin does there.
test.use({ storageState: { cookies: [], origins: [] } });

const newEmail = (name: string) => `${name}-${Date.now()}@example.com`;

test("a visitor and an ordinary account cannot get into the administration", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/connexion\?next=%2Fadmin/);

  await logIn(page, SEEDED_USER.email, SEEDED_USER.password);
  // Back on /admin, which is not for them: the odds instead.
  await expect(page).toHaveURL(/\/cotes/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/cotes/);
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);

  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
});

test("an admin lists the accounts, blocks one that is then locked out, and makes another an admin", async ({ page, browser, request }) => {
  const blocked = newEmail("bloque");
  const promoted = newEmail("promu");
  await createConfirmedAccount(request, blocked, NEW_PASSWORD);
  await createConfirmedAccount(request, promoted, NEW_PASSWORD);

  // The account to block is signed in, in its own browser.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await logIn(otherPage, blocked, NEW_PASSWORD);
  await expect(otherPage).toHaveURL(/\/cotes/);

  await logIn(page, SEEDED_ADMIN.email, SEEDED_ADMIN.password);
  await page.getByRole("link", { name: "Administration" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Administration", level: 1 })).toBeVisible();

  const row = (email: string) => page.getByRole("row", { name: new RegExp(email) });
  await expect(row(blocked)).toContainText("Validé");
  await expect(row(blocked)).toContainText("Aucun abonnement");
  await expect(row(SEEDED_ADMIN.email)).toContainText("Admin");

  page.on("dialog", (dialog) => void dialog.accept());
  await row(blocked).getByRole("button", { name: /Bloquer/ }).click();
  await expect(row(blocked)).toContainText("Bloqué");

  // Signed out at once, and refused at the login.
  expect((await otherPage.request.get("/api/events")).status()).toBe(401);
  await logIn(otherPage, blocked, NEW_PASSWORD);
  await expect(otherPage.getByRole("alert")).toContainText("Ce compte est désactivé");
  await other.close();

  await row(promoted).getByRole("button", { name: /Nommer admin/ }).click();
  await expect(row(promoted)).toContainText("Admin");
  await expect(row(promoted).getByRole("button", { name: /Retirer admin/ })).toBeVisible();

  // An admin does not act on their own account.
  await expect(row(SEEDED_ADMIN.email).getByRole("button", { name: /Bloquer/ })).toBeDisabled();

  // The page reloads on its own address.
  await page.reload();
  await expect(row(blocked)).toContainText("Bloqué");
});
