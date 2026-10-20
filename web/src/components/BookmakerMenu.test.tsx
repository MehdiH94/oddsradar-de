import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookmakerMenu } from "./BookmakerMenu";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "../bookmakers";

const open = () => fireEvent.click(screen.getByRole("button", { name: /^Buchmacher/ }));

describe("BookmakerMenu", () => {
  it("sums up the bookmakers ticked", () => {
    const { rerender } = render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Buchmacher/ })).toHaveAccessibleName("Buchmacher: Alle");

    rerender(<BookmakerMenu selected={["merkurbets"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Buchmacher/ })).toHaveAccessibleName("Buchmacher: Merkur Bets");

    rerender(<BookmakerMenu selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Buchmacher/ })).toHaveAccessibleName("Buchmacher: Keine");
  });

  it("renders every bookmaker checked when all are selected", () => {
    render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    open();

    expect(screen.getByRole("group", { name: "Verglichene Buchmacher" })).toBeInTheDocument();
    for (const name of ["LeoVegas", "Merkur Bets"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
  });

  it("lists the bookmakers in the usual order", () => {
    render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    open();

    // 20bet holds a Curaçao licence, no German one: said, as a fact.
    expect(screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["LeoVegas", "Merkur Bets", "20bet · nicht GGL-lizenziert", "Admiralbet", "bet-at-home", "ODDSET", "Betway", "Tipico", "Winamax"]);
  });

  it("shows each bookmaker's icon and name, read once", () => {
    const { container } = render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    open();

    for (const name of ["LeoVegas", "Merkur Bets", "20bet", "Admiralbet", "bet-at-home", "ODDSET", "Betway", "Tipico", "Winamax"]) expect(screen.getByText(name)).toBeInTheDocument();
    // The icons sit next to the names: decorative, not read a second time.
    // One per bookmaker that has an icon; the others show their name alone.
    const withIcon = ALL_BOOKMAKERS.filter((id) => BOOKMAKER_BRANDING[id]?.logo).length;
    expect(withIcon).toBe(8);
    expect(container.querySelectorAll("img.bookmaker-logo")).toHaveLength(withIcon);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders an unselected bookmaker unchecked", () => {
    render(<BookmakerMenu selected={["leovegas"]} onChange={() => {}} />);
    open();

    expect(screen.getByRole("checkbox", { name: "LeoVegas" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Merkur Bets" })).not.toBeChecked();
  });

  it("unchecking a bookmaker removes it from the emitted list, and stays open for another", () => {
    const onChange = vi.fn();
    render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={onChange} />);
    open();

    fireEvent.pointerDown(screen.getByText("LeoVegas"));
    fireEvent.click(screen.getByText("LeoVegas"));

    expect(onChange).toHaveBeenCalledWith(["merkurbets", "twentybet", "admiralbet", "betathome", "oddset", "betway", "tipico", "winamaxde"]);
    expect(screen.getByRole("checkbox", { name: "Merkur Bets" })).toBeInTheDocument();
  });

  it("re-checking a bookmaker restores ALL_BOOKMAKERS order regardless of click order", () => {
    const onChange = vi.fn();
    render(<BookmakerMenu selected={["merkurbets"]} onChange={onChange} />);
    open();

    fireEvent.click(screen.getByRole("checkbox", { name: "LeoVegas" }));

    expect(onChange).toHaveBeenCalledWith(["leovegas", "merkurbets"]);
  });
});
