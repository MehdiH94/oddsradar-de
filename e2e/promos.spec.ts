import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, SITE_PROMO } from "./fixtures";

// The Promos page: the promotions an account writes down, one card per bookmaker, each marked as taken or not,
// kept with the account. The seeded account's session (a new account would spend the registrations' rate limit,
// which the account specs use up); a title of this run's own, so that a retry's leftover is not taken for it.
test("an account writes a promo down, marks it taken, finds it so after a reload, and deletes it", async ({ page }) => {
  const title = `100 % bis 100 € (${Date.now()})`;
  await page.goto("/odds");
  await page.getByRole("navigation", { name: "Hauptnavigation" }).locator("label", { hasText: "Promos" }).click();
  await expect(page).toHaveURL(/\/promos$/);
  await expect(page).toHaveTitle(/Promos/);

  // A bookmaker the site knows, written in lower case, is filed under its name.
  await page.getByLabel("Buchmacher").fill("winamax");
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Bedingungen (optional)").fill("Umsatz 5x");
  await page.getByLabel("Link (optional)").fill("https://www.winamax.de/promotions");
  await page.getByRole("button", { name: "Promo speichern" }).click();
  await expect(page.getByText("Promo gespeichert.")).toBeVisible();

  const card = page.getByRole("region", { name: "Winamax" });
  await expect(card.getByRole("heading", { name: title })).toBeVisible();
  await expect(card.getByText("Umsatz 5x")).toBeVisible();
  await expect(card.getByRole("link", { name: `Zur Aktion: ${title}` })).toHaveAttribute("href", "https://www.winamax.de/promotions");
  const taken = card.getByRole("button", { name: `Genommen: ${title}` });
  await expect(taken).toHaveAttribute("aria-pressed", "false");
  await taken.click();
  await expect(taken).toHaveAttribute("aria-pressed", "true");
  await expect(taken).toHaveText("✓ Genommen");

  // Kept with the account: still taken after a reload.
  await expect
    .poll(async () => {
      const { promos } = (await (await page.request.get("/api/promos")).json()) as { promos: Array<{ title: string; takenAt: string | null }> };
      return promos.find((p) => p.title === title)?.takenAt ?? null;
    })
    .not.toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: `Genommen: ${title}` })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: `Löschen: ${title}` }).click();
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Promos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
});

// The seeded site promotion's id and mark, as the account's list gives them.
async function sitePromo(page: Page): Promise<{ id: number; takenAt: string | null }> {
  const { promos } = (await (await page.request.get("/api/promos")).json()) as {
    promos: Array<{ id: number; title: string; takenAt: string | null }>;
  };
  const promo = promos.find((p) => p.title === SITE_PROMO.title);
  if (!promo) throw new Error("the seeded site promotion is missing");
  return promo;
}

const setTaken = (page: Page, id: number, taken: boolean) =>
  page.request.put(`/api/promos/${id}/taken`, { data: { taken }, headers: { Origin: BASE_URL } });

// A promotion the site found itself in the last day: "Neu" on its card, counted on the navigation's Promos
// entry from any page, and no longer counted once the account marks it taken. Left unmarked at the end, and
// unmarked first, so that a retry starts as the first try did.
test("a promotion the site just found is marked new and counted on the navigation until it is taken", async ({ page }) => {
  const { id } = await sitePromo(page);
  expect((await setTaken(page, id, false)).status()).toBe(204);

  await page.goto("/odds");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("radio", { name: "Promos (1 neu)" })).toBeAttached();

  await nav.locator("label", { hasText: "Promos" }).click();
  await expect(page).toHaveURL(/\/promos$/);
  const card = page.getByRole("region", { name: "neobet" });
  await expect(card.getByRole("heading", { level: 3, name: `Neu ${SITE_PROMO.title}` })).toBeVisible();
  await expect(card.getByText(SITE_PROMO.details)).toBeVisible();
  // The site's own promotions are marked, not deleted.
  await expect(card.getByRole("button", { name: `Löschen: ${SITE_PROMO.title}` })).toHaveCount(0);

  await card.getByRole("button", { name: `Genommen: ${SITE_PROMO.title}` }).click();
  await expect(nav.getByRole("radio", { name: "Promos" })).toBeChecked();
  await expect.poll(async () => (await sitePromo(page)).takenAt).not.toBeNull();
  await page.goto("/odds");
  await expect(nav.getByRole("radio", { name: "Promos" })).toBeAttached();
  await expect(nav.getByRole("radio", { name: "Promos (1 neu)" })).toHaveCount(0);

  expect((await setTaken(page, id, false)).status()).toBe(204);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor is sent to the login page and back to the promos, and the API is closed to them", async ({ page, request }) => {
    await page.goto("/promos");
    await expect(page).toHaveURL(/\/login\?next=%2Fpromos/);
    expect((await request.get("/api/promos")).status()).toBe(401);
  });
});
