import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BestPrice } from "./BestPrice";

describe("BestPrice", () => {
  it("shows the price large, its bookmaker, and the fair odds when it is no value bet", () => {
    const { container } = render(<BestPrice label="X" name="Unentschieden" price={3.6} bookmakers={["leovegas"]} fair={3.7} />);

    expect(screen.getByText("Unentschieden: 3,60 bei LeoVegas, faire Quote 3,70")).toBeInTheDocument();
    expect(container.firstElementChild).not.toHaveAttribute("data-value");
    expect(container.textContent).toContain("Fair 3,70");
  });

  it("frames a value bet and shows its edge, read out too", () => {
    const { container } = render(
      <BestPrice label="1" name="PSG" price={1.66} bookmakers={["leovegas", "merkurbets"]} fair={1.62} edge={0.025} />
    );

    expect(container.firstElementChild).toHaveAttribute("data-value");
    expect(screen.getByText(/^PSG: 1,66 bei LeoVegas und Merkur Bets, Value Bet \+2,5/)).toBeInTheDocument();
    // The second bookmaker at that price is counted, not shown.
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("shows the fair odds instead of the edge where the edge is shown elsewhere", () => {
    render(<BestPrice label="Merkur Bets" name="PSG" price={1.6} bookmakers={["merkurbets"]} fair={1.5} edge={0.067} showFair />);

    expect(screen.getByText(/Value Bet \+6,7.*faire Quote 1,50/)).toBeInTheDocument();
  });

  it("shows a boosted price after the price, never as it, read out too", () => {
    const { container } = render(
      <BestPrice label="2" name="Cagliari" price={3.05} bookmakers={["twentybet"]} boost={{ price: 3.17, bookmaker: "twentybet" }} />
    );

    expect(screen.getByText("Cagliari: 3,05 bei 20bet, geboostet auf 3,17 bei 20bet")).toBeInTheDocument();
    expect(container.querySelector('[title="Quoten-Boost bei 20bet: 3,17"]')).not.toBeNull();
    expect(container.textContent).toContain("3,053,17");
  });

  it("shows a dash without any price", () => {
    render(<BestPrice label="2" name="OM" price={undefined} bookmakers={[]} />);

    expect(screen.getByText("OM: keine Quote")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
