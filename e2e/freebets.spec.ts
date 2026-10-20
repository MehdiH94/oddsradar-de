import { expect, Page, test } from "@playwright/test";
import { BASE_URL, EXCHANGE_MATCH, NEW_PASSWORD, SECOND_VALUE_MATCH, SUREBET_MATCH, VALUE_MATCH } from "./fixtures";
import { createConfirmedAccount, logIn } from "./helpers";

// The Freebets page: the account's freebets, saved with the account, and the conversions computed from the seeded
// matches. LeoVegas's and Merkur Bets's prices on the seeded matches are fixtures.ts's; the figures below are what the
// engine finds on them (a surebet, a value bet and a plain match are the three best single bets of 50 FB).
const teams = (match: { participants: string[] }) => match.participants.join(" – ");
const wallet = (page: Page, bookmaker: string) => page.getByLabel(`Freebets bei ${bookmaker} in Euro`);
const saved = (page: Page) => expect(page.getByText("In deinem Konto gespeichert")).toBeVisible();

// The account's freebets, set through the API: the specs that are not about entering them start from it. The
// server only takes the accounts' requests from its own origin.
async function setWallet(page: Page, amounts: Record<string, number>): Promise<void> {
  const res = await page.request.put("/api/freebets/wallet", { data: { wallet: amounts }, headers: { Origin: BASE_URL } });
  expect(res.ok()).toBe(true);
}

// A radio button the site styles as a chip: its native input is hidden, so it is checked rather than clicked.
const pick = (page: Page, name: string | RegExp) => page.getByRole("radio", { name }).check({ force: true });

test("freebets at two bookmakers become the three best bets, with where to place each one, and the list copies", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
  // Opened by its address, not reached from another page.
  await page.goto("/freebets");
  await expect(page).toHaveTitle(/Freebets/);
  await wallet(page, "LeoVegas").fill("30");
  await wallet(page, "Merkur Bets").fill("20");
  await saved(page);

  // Three bets on three different matches, the best guaranteed cash first.
  const top = page.getByRole("region", { name: "Top-3-Umwandlungen · Einzelwette" });
  const cards = top.getByRole("button");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText(teams(SUREBET_MATCH));
  await expect(cards.nth(0)).toContainText("66,2 %");
  await expect(cards.nth(0)).toContainText("33,10 €");
  await expect(cards.nth(1)).toContainText(teams(VALUE_MATCH));
  await expect(cards.nth(2)).toContainText(teams(SECOND_VALUE_MATCH));
  await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "true");

  // The first one: every outcome of the match covered, no bookmaker carrying them all.
  await expect(page.getByRole("heading", { name: "Umwandlung 1 · 4 Wetten platzieren" })).toBeVisible();
  const leovegas = page.getByRole("article", { name: "LeoVegas" });
  await expect(leovegas).toContainText("30,00 FB von 30,00 genutzt");
  await expect(leovegas.getByRole("listitem").nth(0)).toHaveText(/Lyon\s*20,69 FB/);
  await expect(leovegas.getByRole("listitem").nth(1)).toHaveText(/Lille\s*9,31 FB/);
  const merkurbets = page.getByRole("article", { name: "Merkur Bets" });
  await expect(merkurbets.getByRole("listitem")).toHaveText([/Draw\s*11,83 FB/, /Lille\s*8,17 FB/]);

  // What the figures are worth: indicative prices, and stake limits the calculation does not know.
  await expect(page.getByRole("note")).toContainText("Unverbindliche Quoten.");
  await expect(page.getByRole("note")).toContainText("weder die Mindest- noch die Höchsteinsätze der einzelnen Buchmacher");

  // The list to paste at the bookmaker.
  await leovegas.getByRole("button", { name: "Liste kopieren" }).click();
  await expect(leovegas.getByRole("status")).toHaveText("Liste kopiert");
  // Windows' clipboard gives the lines back with CRLF.
  expect((await page.evaluate<string>("navigator.clipboard.readText()")).replace(/\r\n/g, "\n")).toBe("LeoVegas: 2 Freebet-Wetten\n- Lyon: 20,69 FB\n- Lille: 9,31 FB");

  // Another conversion shows its own match and bets.
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: /^Umwandlung 2 · \d Wetten platzieren$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Umwandlung 2/ })).toContainText(teams(VALUE_MATCH));
});

test("the settings are kept in the address and the freebets in the account, whatever the page is reloaded with", async ({ page }) => {
  await setWallet(page, { leovegas: 30, merkurbets: 20 });
  await page.goto("/freebets?mode=bookmakers&legs=2");
  await expect(page.getByRole("radio", { name: "2er-Kombiwette" })).toBeChecked();
  // The freebets are read back from the account.
  await expect(wallet(page, "LeoVegas")).toHaveValue("30");
  await expect(wallet(page, "Merkur Bets")).toHaveValue("20");
  // Two matches per bet, and a match in one combo only: with the five seeded matches there are two combos.
  const combos = page.getByRole("region", { name: "Top-Umwandlungen · 2er-Kombiwette" });
  await expect(combos.getByRole("button")).toHaveCount(2);

  // What is not the default is in the address, what is the default is not.
  await expect(page).toHaveURL(/legs=2/);
  await pick(page, "Einzelwette");
  await expect(page).toHaveURL(/\/freebets$/);
  await pick(page, "Gegen die Wettbörse");
  await expect(page).toHaveURL(/mode=exchange/);
  await page.reload();
  await expect(page.getByRole("radio", { name: "Gegen die Wettbörse" })).toBeChecked();
  await expect(wallet(page, "LeoVegas")).toHaveValue("30");
});

test("against the exchange, one bookmaker's freebets are bet and laid, and each case shows what is left", async ({ page }) => {
  await setWallet(page, { leovegas: 30, merkurbets: 20 });
  await page.goto("/freebets?mode=exchange&bookmaker=leovegas");
  // The only match with money to lay: Nantes to win, LeoVegas's 3.60 against the exchange's 3.70.
  await expect(page.getByRole("region", { name: /^Top-Umwandlungen · LeoVegas · 30,00 FB$/ })).toContainText(teams(EXCHANGE_MATCH));
  const top = page.getByRole("region", { name: /^Top-Umwandlungen/ });
  await expect(top).toContainText("68,7 %");
  await expect(top).toContainText("20,61 €");
  await expect(top).toContainText("Wandelt den ganzen Rest um");

  await expect(page.getByRole("heading", { name: "Umwandlung 1 · zwei Wetten platzieren" })).toBeVisible();
  const detail = page.getByRole("region", { name: "Umwandlung 1 · zwei Wetten platzieren" });
  await expect(detail).toContainText("Back 30,00 FB auf");
  await expect(detail).toContainText("Gewinnt sie, bringt die Freebet 78,00 €");
  await expect(detail).toContainText("Lay 21,25 € auf");
  await expect(detail).toContainText("57,38 €");
  // Whichever way the match goes, the same money: +78.00 - 57.38 if Nantes win, +21.25 less 3% otherwise.
  await expect(detail.getByRole("heading", { name: /Unabhängig vom Ergebnis behältst du (mindestens )?20,61\s€/ })).toBeVisible();
  await expect(detail).toContainText("Wenn Nantes gewinnt");
  await expect(detail).toContainText("Wenn Nantes nicht gewinnt (Toulouse gewinnt oder Unentschieden)");

  // The same warning on the prices, without the bookmakers' stake limits (the lay is the exchange's).
  await expect(page.getByRole("note")).toContainText("Unverbindliche Quoten.");
  await expect(page.getByRole("note")).not.toContainText("Mindest- noch die Höchsteinsätze");

  // The other bookmaker's freebets, the choice kept in the address.
  await pick(page, /Merkur Bets/);
  await expect(page).toHaveURL(/bookmaker=merkurbets/);
  await expect(page.getByRole("region", { name: /^Top-Umwandlungen · Merkur Bets · 20,00 FB$/ })).toContainText(teams(EXCHANGE_MATCH));
});

test("a new account is asked for its freebets, and with one bookmaker's only is offered the exchange", async ({ page, request }) => {
  const email = `freebets-${Date.now()}@example.com`;
  await createConfirmedAccount(request, email, NEW_PASSWORD);
  await page.context().clearCookies();
  await logIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/odds/);

  await page.getByRole("navigation", { name: "Main navigation" }).getByText("Freebets", { exact: true }).click();
  await expect(page).toHaveURL(/\/freebets/);
  await expect(page.getByText("Trag oben deine Freebets ein, um zu sehen, wie du sie umwandelst.")).toBeVisible();

  // One bookmaker is not enough between bookmakers: the page says so and offers the exchange.
  await wallet(page, "LeoVegas").fill("30");
  await saved(page);
  await expect(page.getByText(/Deine Freebets liegen nur bei einem Buchmacher/)).toBeVisible();
  await page.getByRole("button", { name: "Gegen die Wettbörse umwandeln" }).click();
  await expect(page).toHaveURL(/mode=exchange/);
  await expect(page.getByRole("region", { name: /^Top-Umwandlungen · LeoVegas · 30,00 FB$/ })).toContainText(teams(EXCHANGE_MATCH));

  // The freebets are the account's: they come back after a reload, and the seeded account's are not shown.
  await page.reload();
  await expect(wallet(page, "LeoVegas")).toHaveValue("30");
  await expect(wallet(page, "Merkur Bets")).toHaveValue("");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor is sent to the login page and back to the freebets, and the API is closed to them", async ({ page, request }) => {
    await page.goto("/freebets?mode=exchange");
    await expect(page).toHaveURL(/\/login\?next=%2Ffreebets%3Fmode%3Dexchange/);
    for (const path of ["/api/freebets/wallet", "/api/freebets/conversions?mode=bookmakers&legs=1"]) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
  });
});
