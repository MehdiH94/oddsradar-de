import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortMenu } from "./SortMenu";

describe("SortMenu", () => {
  it("sums up the current order", () => {
    const { rerender } = render(<SortMenu value="trj" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Tri : Meilleur TRJ" })).toBeInTheDocument();

    rerender(<SortMenu value="start" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Tri : Date de début" })).toBeInTheDocument();
  });

  it("opens on both orders, the current one checked, and reports the one clicked and closes", () => {
    const onChange = vi.fn();
    render(<SortMenu value="trj" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Tri : Meilleur TRJ" }));
    expect(screen.getByRole("group", { name: "Trier par" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Meilleur TRJ" })).toBeChecked();

    fireEvent.pointerDown(screen.getByText("Date de début"));
    fireEvent.click(screen.getByText("Date de début"));

    expect(onChange).toHaveBeenCalledWith("start");
    expect(screen.queryByRole("group", { name: "Trier par" })).not.toBeInTheDocument();
  });

  it("offers the given orders only, in their order", () => {
    const { rerender } = render(<SortMenu value="trj" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Tri : Meilleur TRJ" }));
    expect(screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual([
      "Meilleur TRJ",
      "Date de début",
    ]);

    rerender(<SortMenu value="value" onChange={() => {}} orders={["value", "start"]} />);
    expect(screen.getByRole("button", { name: "Tri : Meilleure value" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Meilleure value" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Meilleur TRJ" })).not.toBeInTheDocument();
  });
});
