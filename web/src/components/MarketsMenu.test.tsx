import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarketsMenu } from "./MarketsMenu";

describe("MarketsMenu", () => {
  it("sums up which matches it keeps", () => {
    const { rerender } = render(<MarketsMenu players={false} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Marchés : Tous" })).toBeInTheDocument();

    rerender(<MarketsMenu players onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Marchés : Joueurs" })).toBeInTheDocument();
  });

  it("opens on every match or those with players' markets, and reports the one clicked and closes", () => {
    const onChange = vi.fn();
    render(<MarketsMenu players={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Marchés : Tous" }));
    expect(screen.getByRole("group", { name: "Garder les matchs" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tous les matchs" })).toBeChecked();

    fireEvent.pointerDown(screen.getByText("Avec marchés joueurs"));
    fireEvent.click(screen.getByText("Avec marchés joueurs"));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("group", { name: "Garder les matchs" })).not.toBeInTheDocument();
  });
});
