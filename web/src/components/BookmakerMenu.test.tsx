import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookmakerMenu } from "./BookmakerMenu";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "../bookmakers";

const open = () => fireEvent.click(screen.getByRole("button", { name: /^Bookmakers/ }));

describe("BookmakerMenu", () => {
  it("sums up the bookmakers ticked", () => {
    const { rerender } = render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Bookmakers/ })).toHaveAccessibleName("Bookmakers : Tous");

    rerender(<BookmakerMenu selected={["betclic"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Bookmakers/ })).toHaveAccessibleName("Bookmakers : Betclic");

    rerender(<BookmakerMenu selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Bookmakers/ })).toHaveAccessibleName("Bookmakers : Aucun");
  });

  it("renders every bookmaker checked when all are selected", () => {
    render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    open();

    expect(screen.getByRole("group", { name: "Bookmakers comparés" })).toBeInTheDocument();
    for (const name of ["Winamax", "Betclic"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
  });

  it("lists the bookmakers in the usual order", () => {
    render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    open();

    expect(screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["Winamax", "Betclic"]);
  });

  it("shows each bookmaker's icon and name, read once", () => {
    const { container } = render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={() => {}} />);
    open();

    for (const name of ["Winamax", "Betclic"]) expect(screen.getByText(name)).toBeInTheDocument();
    // The icons sit next to the names: decorative, not read a second time.
    // One per bookmaker that has an icon; the others show their name alone.
    const withIcon = ALL_BOOKMAKERS.filter((id) => BOOKMAKER_BRANDING[id]?.logo).length;
    expect(withIcon).toBe(2);
    expect(container.querySelectorAll("img.bookmaker-logo")).toHaveLength(withIcon);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders an unselected bookmaker unchecked", () => {
    render(<BookmakerMenu selected={["winamax"]} onChange={() => {}} />);
    open();

    expect(screen.getByRole("checkbox", { name: "Winamax" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Betclic" })).not.toBeChecked();
  });

  it("unchecking a bookmaker removes it from the emitted list, and stays open for another", () => {
    const onChange = vi.fn();
    render(<BookmakerMenu selected={ALL_BOOKMAKERS} onChange={onChange} />);
    open();

    fireEvent.pointerDown(screen.getByText("Winamax"));
    fireEvent.click(screen.getByText("Winamax"));

    expect(onChange).toHaveBeenCalledWith(["betclic"]);
    expect(screen.getByRole("checkbox", { name: "Betclic" })).toBeInTheDocument();
  });

  it("re-checking a bookmaker restores ALL_BOOKMAKERS order regardless of click order", () => {
    const onChange = vi.fn();
    render(<BookmakerMenu selected={["betclic"]} onChange={onChange} />);
    open();

    fireEvent.click(screen.getByRole("checkbox", { name: "Winamax" }));

    expect(onChange).toHaveBeenCalledWith(["winamax", "betclic"]);
  });
});
