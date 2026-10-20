import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortMenu } from "./SortMenu";

describe("SortMenu", () => {
  it("sums up the current order", () => {
    const { rerender } = render(<SortMenu value="trj" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Sortieren: Beste Auszahlungsquote" })).toBeInTheDocument();

    rerender(<SortMenu value="start" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Sortieren: Anstoßzeit" })).toBeInTheDocument();
  });

  it("opens on both orders, the current one checked, and reports the one clicked and closes", () => {
    const onChange = vi.fn();
    render(<SortMenu value="trj" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sortieren: Beste Auszahlungsquote" }));
    expect(screen.getByRole("group", { name: "Sortieren nach" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Beste Auszahlungsquote" })).toBeChecked();

    fireEvent.pointerDown(screen.getByText("Anstoßzeit"));
    fireEvent.click(screen.getByText("Anstoßzeit"));

    expect(onChange).toHaveBeenCalledWith("start");
    expect(screen.queryByRole("group", { name: "Sortieren nach" })).not.toBeInTheDocument();
  });

  it("offers the given orders only, in their order", () => {
    const { rerender } = render(<SortMenu value="trj" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sortieren: Beste Auszahlungsquote" }));
    expect(screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual([
      "Beste Auszahlungsquote",
      "Anstoßzeit",
    ]);

    rerender(<SortMenu value="value" onChange={() => {}} orders={["value", "start"]} />);
    expect(screen.getByRole("button", { name: "Sortieren: Bester Value" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Bester Value" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Beste Auszahlungsquote" })).not.toBeInTheDocument();
  });
});
