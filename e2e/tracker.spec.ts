import { expect, test } from "@playwright/test";
import { SUREBET_MATCH, VALUE_MATCH } from "./fixtures";

// The bet tracker end to end, as the seeded account uses it: a surebet and a
// value bet marked taken on the dashboard, their stakes written down in
// "Meine Surebets" and "Meine Value Bets", kept after a reload, and the marks
// taken off with "Entfernen". The seed's prices are fixtures.ts's.
const teams = (match: { participants: string[] }) => match.participants.join(" - ");

test("a taken surebet's stakes are split, kept, and go with Entfernen", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/odds?sport=value-bets&sort=value");
  const surebets = page.getByRole("region", { name: "Surebets" });
  const button = surebets.getByRole("button", { name: `Genommen: ${teams(SUREBET_MATCH)}` });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");

  // "Meine Surebets": 100 EUR split as the list splits it, rounded to the
  // euro (39 + 27 + 34): any outcome pays 101,40 EUR at least.
  await page.getByText("Meine Surebets (1)").click();
  await page.getByText("Meine Einsätze").click();
  await page.getByRole("textbox", { name: "Gesamteinsatz in Euro, auf die Wetten aufzuteilen" }).fill("100");
  await page.getByRole("button", { name: "Aufteilen" }).click();
  await expect(page.getByRole("textbox", { name: "Einsatz bei LeoVegas (2,60) in Euro" })).toHaveValue("39");
  await expect(page.getByText("Gesichert: +1,40 € bei 100,00 € Einsatz")).toBeVisible();

  // Kept with the account.
  await page.reload();
  await page.getByText("Meine Surebets (1)").click();
  await page.getByText("Meine Einsätze").click();
  await expect(page.getByRole("textbox", { name: "Einsatz bei Merkur Bets (3,80) in Euro" })).toHaveValue("27");
  await expect(page.getByText("Gesichert: +1,40 € bei 100,00 € Einsatz")).toBeVisible();

  // Taken off from the list, the stakes with it (the confirmation accepted).
  await page.getByRole("button", { name: /^Entfernen: / }).click();
  await expect(page.getByText(/^Meine Surebets/)).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(surebets.getByRole("button", { name: `Genommen: ${teams(SUREBET_MATCH)}` })).toHaveAttribute("aria-pressed", "false");
});

test("a taken value bet's stake and expected profit are kept, and go with Entfernen", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/odds?sport=value-bets&sort=value");
  const valueBets = page.getByRole("region", { name: "Value Bets" });
  const row = valueBets.getByRole("row").filter({ hasText: teams(VALUE_MATCH) }).first();
  const button = row.getByRole("button", { name: /^Genommen: / });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveAttribute("data-taken", "true");

  await page.getByText("Meine Value Bets (1)").click();
  const stake = page.getByRole("textbox", { name: /^Einsatz bei .* in Euro$/ });
  await stake.fill("20");
  await stake.blur();
  await expect(page.getByText(/^Einsatz 20,00 € · erwartet \+\d+,\d\d €$/)).toBeVisible();

  await page.reload();
  await page.getByText("Meine Value Bets (1)").click();
  await expect(page.getByRole("textbox", { name: /^Einsatz bei .* in Euro$/ })).toHaveValue("20");

  await page.getByRole("button", { name: /^Entfernen: / }).click();
  await expect(page.getByText(/^Meine Value Bets/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/^Meine Value Bets/)).toHaveCount(0);
});
