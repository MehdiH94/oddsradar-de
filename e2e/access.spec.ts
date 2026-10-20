import { expect, test } from "@playwright/test";
import { SEEDED_USER, TENNIS_MATCH, VALUE_MATCH } from "./fixtures";

// Who may see the odds. Everyone here starts signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("a signed-out visitor on the dashboard is sent to the login page, and back to where they were after it", async ({ page }) => {
  await page.goto("/odds?sport=tennis&sort=trj");
  await expect(page).toHaveURL(/\/login\?next=%2Fodds%3Fsport%3Dtennis/);
  await expect(page.getByRole("heading", { name: "Anmelden", level: 1 })).toBeVisible();

  await page.getByLabel("E-Mail-Adresse").fill(SEEDED_USER.email);
  await page.getByLabel("Passwort", { exact: true }).fill(SEEDED_USER.password);
  await page.getByRole("button", { name: "Anmelden" }).click();

  // Back on the dashboard, with the filter the link carried.
  await expect(page).toHaveURL(/\/odds\?sport=tennis/);
  await expect(page.getByRole("region", { name: "Tennis" })).toContainText(TENNIS_MATCH.participants.join(" - "));
});

test("the odds' API answers 401 without a session, and only the public routes answer", async ({ request }) => {
  for (const path of ["/api/events", "/api/value-bets", `/api/events/${VALUE_MATCH.id}`, "/api/sports", "/api/alerts"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(401);
  }

  expect((await request.get("/api/health")).ok()).toBe(true);
  const home = await request.get("/api/public/home");
  expect(home.ok()).toBe(true);
  // Totals only: nothing a signed-out visitor could use to bet.
  const body = await home.text();
  for (const team of VALUE_MATCH.participants) expect(body).not.toContain(team);
});

test("the site's pages load when opened or reloaded, not only when reached from another", async ({ page }) => {
  const pages = [
    { path: "/", heading: /Die besten Quoten der deutschen Buchmacher/ },
    { path: "/login", heading: "Anmelden" },
    { path: "/signup", heading: "Konto erstellen" },
    { path: "/forgot-password", heading: "Passwort vergessen" },
  ];
  for (const { path, heading } of pages) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { name: heading }).first(), path).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: heading }).first(), `${path} reloaded`).toBeVisible();
  }

  // An address that is not a page is still a 404.
  expect((await page.request.get("/cette-page-n-existe-pas")).status()).toBe(404);
});
