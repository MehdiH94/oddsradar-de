import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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
});
