import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortMenu } from "./SortMenu";

describe("SortMenu", () => {
  it("sums up the current order", () => {
    const { rerender } = render(<SortMenu value="trj" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Sort: Best payout" })).toBeInTheDocument();

    rerender(<SortMenu value="start" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Sort: Kick-off time" })).toBeInTheDocument();
  });

  it("opens on both orders, the current one checked, and reports the one clicked and closes", () => {
    const onChange = vi.fn();
    render(<SortMenu value="trj" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sort: Best payout" }));
    expect(screen.getByRole("group", { name: "Sort by" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Best payout" })).toBeChecked();

    fireEvent.pointerDown(screen.getByText("Kick-off time"));
    fireEvent.click(screen.getByText("Kick-off time"));

    expect(onChange).toHaveBeenCalledWith("start");
    expect(screen.queryByRole("group", { name: "Sort by" })).not.toBeInTheDocument();
  });

  it("offers the given orders only, in their order", () => {
    const { rerender } = render(<SortMenu value="trj" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort: Best payout" }));
    expect(screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual([
      "Best payout",
      "Kick-off time",
    ]);

    rerender(<SortMenu value="value" onChange={() => {}} orders={["value", "start"]} />);
    expect(screen.getByRole("button", { name: "Sort: Best value" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Best value" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Best payout" })).not.toBeInTheDocument();
  });
});
