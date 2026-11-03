import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceChip } from "./PriceChip";

const chip = (bookmaker: string, price: number | null = 1.9) =>
  render(<PriceChip bookmaker={bookmaker} price={price ?? undefined} best={false} />).container.firstElementChild!;

describe("PriceChip", () => {
  it("says in its tooltip what betting tax its price is net of", () => {
    expect(chip("leovegas")).toHaveAttribute("title", "Quote nach Abzug von 5 % Wettsteuer");
    expect(chip("betway")).toHaveAttribute("title", "Quote nach Abzug von 5,3 % Wettsteuer");
    expect(chip("vbet")).toHaveAttribute("title", "Quote nach Abzug von 5 % Wettsteuer");
    expect(chip("twentybet")).toHaveAttribute("title", "Quote ohne Wettsteuer");
    expect(chip("tipico")).toHaveAttribute("title", "Quote ohne Wettsteuer");
    expect(chip("winamaxde")).toHaveAttribute("title", "Quote ohne Wettsteuer");
    expect(chip("unknown")).toHaveAttribute("title", "Quote wie angeboten, Wettsteuer nicht abgezogen");
  });

  it("has no tooltip without a price", () => {
    expect(chip("leovegas", null)).not.toHaveAttribute("title");
  });

  it("shows an arrow after a price that moved, up or down, its price before and when in its tooltip and read out", () => {
    const at = new Date(2026, 10, 2, 14, 5).toISOString();
    const { container, rerender } = render(<PriceChip bookmaker="leovegas" price={2.05} best={false} moved={{ from: 1.95, at }} />);
    const up = container.querySelector("[data-move]")!;
    expect(up).toHaveAttribute("data-move", "up");
    expect(up).toHaveAttribute("title", "Quote gestiegen von 1,95 um 14:05");
    expect(screen.getByText(/\(gestiegen von 1,95 um 14:05\)/)).toHaveClass("visually-hidden");
    rerender(<PriceChip bookmaker="leovegas" price={1.85} best={false} moved={{ from: 1.95, at }} />);
    expect(container.querySelector("[data-move]")).toHaveAttribute("data-move", "down");
    rerender(<PriceChip bookmaker="leovegas" price={1.85} best={false} />);
    expect(container.querySelector("[data-move]")).toBeNull();
  });

  it("lists the day's moves after the last one in the arrow's tooltip, when there were more", () => {
    const at = (h: number, m: number) => new Date(2026, 10, 2, h, m).toISOString();
    const history = [
      { from: 1.9, at: at(9, 10) },
      { from: 1.95, at: at(14, 5) },
    ];
    const { container } = render(<PriceChip bookmaker="leovegas" price={2.05} best={false} moved={history[1]} history={history} />);
    expect(container.querySelector("[data-move]")).toHaveAttribute(
      "title",
      "Quote gestiegen von 1,95 um 14:05 · Verlauf: 1,90 → 1,95 → 2,05 seit 09:10"
    );
  });
});
