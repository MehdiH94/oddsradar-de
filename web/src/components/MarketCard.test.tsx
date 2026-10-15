import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketCard } from "./MarketCard";
import type { MarketDetail } from "../types";

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\u00a0/g, " ");

// The match page's 1X2 with the reference's fair odds: LeoVegas's 2,20 on "1"
// is a value bet, 10 % above the fair 2,00.
const result: MarketDetail = {
  key: "1X2",
  label: "Résultat du match",
  kind: "list",
  compared: true,
  lines: [
    {
      line: null,
      payoutRate: 0.95,
      outcomes: [
        { key: "1", label: "PSG", prices: { leovegas: 2.2, betway: 2 }, best: ["leovegas"], fair: 2, edges: { leovegas: 0.1 } },
        { key: "X", label: "Draw", prices: { leovegas: 3.2, betway: 3.3 }, best: ["betway"], fair: 3.4, edges: {} },
        { key: "2", label: "OM", prices: { leovegas: 3.6, betway: 3.7 }, best: ["betway"], fair: 4, edges: {} },
      ],
    },
  ],
};

describe("MarketCard", () => {
  it("shows the 1X2's fair odds under each outcome's prices, and marks its value bets", () => {
    const { container } = render(<MarketCard market={result} bookmakers={["leovegas", "betway"]} />);
    const lines = [...container.querySelectorAll('[title^="Fair odds"]')];
    expect(lines).toHaveLength(3);
    expect(text(lines[0])).toContain("Fair odds: 2.00");
    expect(text(lines[0])).toContain("+10.0%");
    expect(text(lines[1])).not.toContain("%");

    const valueChip = screen.getByText("2.20").closest("[data-bookmaker]");
    expect(valueChip).toHaveAttribute("data-value", "true");
    expect(container.querySelector('[data-bookmaker="betway"]')).not.toHaveAttribute("data-value");
  });

  it("stacks the icon over the price once many bookmakers share a phone's width", () => {
    const few = render(<MarketCard market={result} bookmakers={["leovegas", "betway"]} />);
    expect(few.container.querySelector("[data-bookmaker]")?.className).not.toContain("compact");
    few.unmount();

    const many = ["leovegas", "betway", "unibet", "pmu", "netbet", "zebet", "betsson"];
    const { container } = render(<MarketCard market={result} bookmakers={many} />);
    const chips = [...container.querySelectorAll("[data-bookmaker]")];
    expect(chips).toHaveLength(many.length * 3);
    expect(chips.every((chip) => chip.className.includes("compact"))).toBe(true);
  });

  it("leaves out an unticked bookmaker's value bet", () => {
    const { container } = render(<MarketCard market={result} bookmakers={["betway"]} />);
    expect(container.querySelector("[data-value]")).toBeNull();
    expect(text(container.querySelector('[title^="Fair odds"]'))).not.toContain("%");
  });

  it("shows no fair odds on a market without them", () => {
    const plain: MarketDetail = {
      ...result,
      key: "double_chance",
      lines: [{ ...result.lines[0], outcomes: result.lines[0].outcomes.map(({ fair: _f, edges: _e, ...o }) => o) }],
    };
    const { container } = render(<MarketCard market={plain} bookmakers={["leovegas", "betway"]} />);
    expect(container.querySelector('[title^="Fair odds"]')).toBeNull();
  });

  it("shows a scorer's fair odds from the exchange the same way", () => {
    const scorers: MarketDetail = {
      key: "anytime_scorer",
      label: "Buteur",
      kind: "list",
      compared: true,
      lines: [
        {
          line: null,
          payoutRate: null,
          outcomes: [
            { key: "Mbappé", label: "Mbappé", prices: { leovegas: 2.3, betway: 1.9 }, best: ["leovegas"], fair: 2, edges: { leovegas: 0.15 } },
            { key: "Kolo", label: "Kolo", prices: { leovegas: 6, betway: 5.5 }, best: ["leovegas"] },
          ],
        },
      ],
    };
    const { container } = render(<MarketCard market={scorers} bookmakers={["leovegas", "betway"]} />);
    const fair = container.querySelectorAll('[title^="Fair odds"]');
    expect(fair).toHaveLength(1);
    expect(text(fair[0])).toContain("Fair odds: 2.00");
    expect(text(fair[0])).toContain("+15.0%");
    expect(screen.getByText("2.30").closest("[data-bookmaker]")).toHaveAttribute("data-value", "true");
  });

  it("shows a loosely priced scorer's ceiling, and an unpriced one's suspect price", () => {
    const scorers: MarketDetail = {
      key: "anytime_scorer",
      label: "Buteur",
      kind: "list",
      compared: true,
      lines: [
        {
          line: null,
          payoutRate: null,
          outcomes: [
            // The exchange's lay, 2,60: LeoVegas's 2,80 is 7,7 % above it.
            { key: "Doué", label: "Doué", prices: { leovegas: 2.8, betway: 2.5 }, best: ["leovegas"], fair: 2.6, fairIsCeiling: true, edges: { leovegas: 2.8 / 2.6 - 1 } },
            // Not on the exchange: LeoVegas's 13 is 44 % above Betway's 9.
            { key: "Lepaul", label: "Lepaul", prices: { leovegas: 13, betway: 9 }, best: ["leovegas"], suspects: { leovegas: 13 / 9 - 1 } },
          ],
        },
      ],
    };
    const { container } = render(<MarketCard market={scorers} bookmakers={["leovegas", "betway"]} />);
    const ceiling = container.querySelector('[title^="Fair odds at most"]');
    expect(text(ceiling)).toBe("Fair ≤ Fair odds: at most 2.60 · , best value: +7.7%");
    const suspect = container.querySelector('[title^="Suspect price"]');
    expect(text(suspect)).toBe("Suspect price · : +44.4% over the other bookmaker");
    const chip = screen.getByText("13.00").closest("[data-bookmaker]");
    expect(chip).toHaveAttribute("data-value", "true");
    expect(text(chip)).toContain("(suspect price: +44.4% over the other bookmaker)");

    // Unticked, LeoVegas's suspect price goes, and its line with it.
    const { container: betclicOnly } = render(<MarketCard market={scorers} bookmakers={["betway"]} />);
    expect(betclicOnly.querySelector('[title^="Suspect price"]')).toBeNull();
    expect(betclicOnly.querySelector("[data-value]")).toBeNull();
  });
});
