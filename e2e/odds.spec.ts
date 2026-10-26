import { expect, Page, test } from "@playwright/test";
import { COMPETITION_WINNER, SECOND_VALUE_MATCH, SUREBET_MATCH, TENNIS_MATCH, VALUE_MATCH } from "./fixtures";

// The odds themselves, as the seeded account sees them (the project's
// storageState). The seed is seed.ts: its matches and prices are fixtures.ts's.
const teams = (match: { participants: string[] }) => match.participants.join(" - ");

// A radio button the site styles as a chip: its native input is hidden, so it
// is checked rather than clicked.
const pick = (page: Page, name: string) => page.getByRole("radio", { name, exact: true }).check({ force: true });

test("the dashboard lists the matches with each outcome's best price, and keeps its filters in the address", async ({ page }) => {
  await page.goto("/odds");
  const football = page.getByRole("region", { name: "Fußball" });

  // Every football match, none of the tennis; the best price of an outcome is
  // the one marked, whichever bookmaker has it.
  for (const match of [VALUE_MATCH, SUREBET_MATCH, SECOND_VALUE_MATCH]) await expect(football).toContainText(teams(match));
  await expect(football).not.toContainText(teams(TENNIS_MATCH));
  const row = football.getByRole("row", { name: new RegExp(teams(VALUE_MATCH)) });
  await expect(row).toContainText("LeoVegas: 2,20 (beste Quote)");
  await expect(row).toContainText("Merkur Bets: 3,30 (beste Quote)");
  await expect(row).toContainText("Merkur Bets: 3,70 (beste Quote)");

  // The sport filter swaps the list, and the address says so.
  await pick(page, "Tennis");
  await expect(page).toHaveURL(/sport=tennis/);
  const tennis = page.getByRole("region", { name: "Tennis" });
  await expect(tennis).toContainText(teams(TENNIS_MATCH));
  await expect(page.getByRole("region", { name: "Fußball" })).toHaveCount(0);

  // The search narrows the football list to one match; reloading the page, or
  // opening its address elsewhere, gives the same view.
  await pick(page, "Fußball");
  await page.getByRole("combobox", { name: "Spiel suchen" }).fill("Lyon");
  await expect(page).toHaveURL(/q=Lyon/);
  await expect(football).toContainText(teams(SUREBET_MATCH));
  await expect(football).not.toContainText(teams(VALUE_MATCH));

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Spiel suchen" })).toHaveValue("Lyon");
  await expect(page.getByRole("region", { name: "Fußball" })).toContainText(teams(SUREBET_MATCH));
  await expect(page.getByRole("region", { name: "Fußball" })).not.toContainText(teams(VALUE_MATCH));
});

test("the bookmakers ticked in the address are the ones whose prices are compared", async ({ page }) => {
  await page.goto("/odds?sport=football&sort=trj&bookmakers=leovegas");
  const row = page.getByRole("region", { name: "Fußball" }).getByRole("row", { name: new RegExp(teams(VALUE_MATCH)) });
  await expect(row).toContainText("LeoVegas: 2,20");
  await expect(row).not.toContainText("Merkur Bets :");
});

test("the value bets list shows each bet's price against the fair odds, the biggest edge first", async ({ page }) => {
  await page.goto("/odds");
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByText("Value Bets", { exact: true }).click();
  await expect(page).toHaveURL(/sport=value-bets/);

  const bets = page.getByRole("region", { name: "Value Bets" });
  const rows = bets.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
  await expect(rows).toHaveCount(2);
  // The home side at LeoVegas, 2,20 against the fair 2,00: +10 %; then Nice's 2,10 against 2,00: +5 %.
  await expect(rows.nth(0)).toContainText(teams(VALUE_MATCH));
  await expect(rows.nth(0)).toContainText("Paris SG");
  await expect(rows.nth(0)).toContainText("LeoVegas: 2,20");
  await expect(rows.nth(0)).toContainText("2,00");
  await expect(rows.nth(0)).toContainText("+10,0 %");
  await expect(rows.nth(1)).toContainText(teams(SECOND_VALUE_MATCH));
  await expect(rows.nth(1)).toContainText("+5,0 %");
});

test("a match opens from the value bets with all its markets, and its back link returns to the list", async ({ page }) => {
  await page.goto("/odds?sport=value-bets&sort=value");
  await page.getByRole("region", { name: "Value Bets" }).getByRole("link", { name: teams(VALUE_MATCH), exact: true }).click();

  await expect(page.getByRole("heading", { name: "Paris SG – Marseille", level: 2 })).toBeVisible();
  await expect(page.getByText("2 Märkte verglichen")).toBeVisible();
  // Its main market, with the TRJ of the best prices, and a market of its own.
  const result = page.getByRole("article", { name: "Spielergebnis (1X2)" });
  await expect(result).toContainText("97,3 %");
  await expect(result).toContainText("LeoVegas: 2,20 (beste Quote)");
  await expect(page.getByRole("article", { name: "Tore gesamt" })).toContainText("2,5");

  await page.getByRole("link", { name: "Alle Value Bets" }).click();
  await expect(page).toHaveURL(/sport=value-bets/);
  await expect(page).not.toHaveURL(/match=/);
  await expect(page.getByRole("region", { name: "Value Bets" })).toContainText(teams(VALUE_MATCH));
});

test("a match's name opens its page from the odds list, even with nothing but its main market", async ({ page }) => {
  await page.goto("/odds?sport=tennis");
  await page.getByRole("region", { name: "Tennis" }).getByRole("link", { name: teams(TENNIS_MATCH), exact: true }).click();

  await expect(page).toHaveURL(/match=e2e-weber-ruiz/);
  await expect(page.getByRole("heading", { name: "Jonas Weber – Mateo Ruiz", level: 2 })).toBeVisible();
  await expect(page.getByRole("article", { name: "Sieger" })).toContainText("Merkur Bets");

  await page.getByRole("link", { name: "Alle Spiele" }).click();
  await expect(page).not.toHaveURL(/match=/);
  await expect(page.getByRole("region", { name: "Tennis" })).toContainText(teams(TENNIS_MATCH));
});

test("a match's competition leads to the matches of that competition, and Back returns to the match", async ({ page }) => {
  await page.goto("/odds?sport=football");
  await page.getByRole("region", { name: "Fußball" }).getByRole("link", { name: teams(VALUE_MATCH), exact: true }).click();
  await expect(page.getByRole("heading", { name: teams(VALUE_MATCH).replace(" - ", " – "), level: 2 })).toBeVisible();

  await page.getByRole("link", { name: `Spiele anzeigen: ${VALUE_MATCH.competition}` }).click();
  await expect(page).toHaveURL(/competition=Ligue\+1/);
  await expect(page).not.toHaveURL(/match=/);
  await expect(page.getByRole("button", { name: `Wettbewerb: ${VALUE_MATCH.competition}` })).toBeVisible();
  // The competition's matches and its winner, as the menu's choice gives.
  const football = page.getByRole("region", { name: "Fußball" });
  await expect(football).toContainText(teams(VALUE_MATCH));
  await expect(football.getByRole("article", { name: COMPETITION_WINNER.title })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: teams(VALUE_MATCH).replace(" - ", " – "), level: 2 })).toBeVisible();
});

test("a surebet shows each leg's bookmaker, price and stake, and what it earns", async ({ page }) => {
  await page.goto("/odds?sport=value-bets&sort=value");
  const surebets = page.getByRole("region", { name: "Surebets" });
  await expect(surebets).toContainText(teams(SUREBET_MATCH));
  // One leg per outcome: who to bet with, at what price, and how much of the 100 EUR.
  const legs = surebets.getByRole("listitem");
  await expect(legs).toHaveCount(3);
  await expect(legs.nth(0)).toHaveText(/Lyon\s*LeoVegas\s*2,60\s*Einsatz 39,20\s€/);
  await expect(legs.nth(1)).toHaveText(/Unentschieden\s*Merkur Bets\s*3,80\s*Einsatz 26,82\s€/);
  await expect(legs.nth(2)).toHaveText(/Lille\s*Merkur Bets\s*3,00\s*Einsatz 33,98\s€/);
  await expect(surebets).toContainText("101,9 %");
  await expect(surebets).toContainText("+1,93 €");
});

test("a surebet marked as taken stays so after a reload, greyed, until the mark is taken off", async ({ page }) => {
  await page.goto("/odds?sport=value-bets&sort=value");
  const surebets = page.getByRole("region", { name: "Surebets" });
  const row = surebets.getByRole("row").filter({ hasText: teams(SUREBET_MATCH) });
  const button = row.getByRole("button", { name: `Genommen: ${teams(SUREBET_MATCH)}` });
  await expect(button).toHaveAttribute("aria-pressed", "false");

  await button.click();
  await expect(button).toHaveText("✓ Genommen");
  await expect(row).toHaveAttribute("data-taken", "true");

  // Kept with the account, not the page.
  await page.reload();
  await expect(button).toHaveAttribute("aria-pressed", "true");

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(button).toHaveAttribute("aria-pressed", "false");
});

test("a match page keeps every ticked bookmaker's price in view on a desktop", async ({ page }) => {
  // Every bookmaker ticked (the default).
  await page.goto(`/odds?match=${VALUE_MATCH.id}`);

  for (const name of ["Spielergebnis (1X2)", "Tore gesamt"]) {
    const card = page.getByRole("article", { name });
    await expect(card).toBeVisible();
    const chips = card.locator("[data-bookmaker]");
    await expect(chips.first()).toBeVisible();
    // No scrollbar in the card, and the last chip is inside it.
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const box = (await card.boundingBox())!;
    const last = (await chips.last().boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(box.x + box.width);
  }
});

test("the winners of the competitions are listed with the matches, each with its contenders' best price", async ({ page }) => {
  // In the football list, beside its matches: there is no list of their own.
  await page.goto("/odds");
  const football = page.getByRole("region", { name: "Fußball" });
  await expect(football.getByRole("article", { name: COMPETITION_WINNER.title })).toBeVisible();
  await expect(football).toContainText(teams(VALUE_MATCH));
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByText("Vainqueurs", { exact: true })).toHaveCount(0);

  // The best price of each contender, whichever of the two bookmakers has it.
  await page.goto("/odds?sport=football&sort=trj");
  const card = page.getByRole("article", { name: COMPETITION_WINNER.title });
  await expect(card).toBeVisible();
  await expect(card.getByRole("row", { name: /Paris Saint-Germain/ })).toContainText("LeoVegas: 1,50 (beste Quote)");
  await expect(card.getByRole("row", { name: /Olympique de Marseille/ })).toContainText("Merkur Bets: 3,40 (beste Quote)");
  await expect(card.getByRole("row", { name: /AS Monaco/ })).toContainText("Merkur Bets: 4,20 (beste Quote)");

  // Not in the other sports' lists.
  await pick(page, "Tennis");
  await expect(page.getByRole("region", { name: "Tennis" })).toContainText(teams(TENNIS_MATCH));
  await expect(page.getByRole("article", { name: COMPETITION_WINNER.title })).toHaveCount(0);
});

test("a competition narrows the list to its matches and its winner, season left out, and the address keeps it", async ({ page }) => {
  await page.goto("/odds");
  const football = page.getByRole("region", { name: "Fußball" });
  await page.getByRole("button", { name: "Wettbewerb: Alle" }).click();
  // « Ligue 1 2026/2027 » is « Ligue 1 »: one entry for the matches and the winner.
  await expect(page.getByRole("radio", { name: /^Ligue 1/ })).toHaveCount(1);
  // The field narrows the list as one types, and Enter takes the first found.
  await page.getByRole("searchbox", { name: "Wettbewerb suchen" }).fill("ligue");
  await expect(page.locator("input[name=competition]")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Wettbewerb suchen" }).press("Enter");

  await expect(page).toHaveURL(/competition=Ligue\+1/);
  await expect(page.getByRole("button", { name: "Wettbewerb: Ligue 1" })).toBeVisible();
  await expect(football).toContainText(teams(VALUE_MATCH));
  await expect(football.getByRole("article", { name: COMPETITION_WINNER.title })).toBeVisible();

  // A reload shows the same view; another sport's competitions are its own.
  await page.reload();
  await expect(page.getByRole("button", { name: "Wettbewerb: Ligue 1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Fußball" }).getByRole("article", { name: COMPETITION_WINNER.title })).toBeVisible();
  await pick(page, "Tennis");
  await expect(page).not.toHaveURL(/competition=/);
  await page.getByRole("button", { name: "Wettbewerb: Alle" }).click();
  await expect(page.getByRole("radio", { name: "ATP Paris", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Ligue 1", exact: true })).toHaveCount(0);
});

test("an old link to the winners' list opens the football matches", async ({ page }) => {
  await page.goto("/odds?sport=vainqueurs&sort=trj");
  await expect(page).toHaveURL(/sport=football/);
  await expect(page.getByRole("region", { name: "Fußball" })).toContainText(teams(VALUE_MATCH));
});
