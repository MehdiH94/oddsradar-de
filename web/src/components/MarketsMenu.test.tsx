import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarketsMenu } from "./MarketsMenu";

describe("MarketsMenu", () => {
  it("sums up which matches it keeps", () => {
    const { rerender } = render(<MarketsMenu players={false} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Märkte: Alle" })).toBeInTheDocument();

    rerender(<MarketsMenu players onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Märkte: Spieler" })).toBeInTheDocument();
  });

  it("opens on every match or those with players' markets, and reports the one clicked and closes", () => {
    const onChange = vi.fn();
    render(<MarketsMenu players={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Märkte: Alle" }));
    expect(screen.getByRole("group", { name: "Spiele anzeigen" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Alle Spiele" })).toBeChecked();

    fireEvent.pointerDown(screen.getByText("Mit Spielermärkten"));
    fireEvent.click(screen.getByText("Mit Spielermärkten"));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("group", { name: "Spiele anzeigen" })).not.toBeInTheDocument();
  });
});
