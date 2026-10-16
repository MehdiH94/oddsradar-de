import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarketsMenu } from "./MarketsMenu";

describe("MarketsMenu", () => {
  it("sums up which matches it keeps", () => {
    const { rerender } = render(<MarketsMenu players={false} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Markets: All" })).toBeInTheDocument();

    rerender(<MarketsMenu players onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Markets: Players" })).toBeInTheDocument();
  });

  it("opens on every match or those with players' markets, and reports the one clicked and closes", () => {
    const onChange = vi.fn();
    render(<MarketsMenu players={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Markets: All" }));
    expect(screen.getByRole("group", { name: "Keep the matches" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All matches" })).toBeChecked();

    fireEvent.pointerDown(screen.getByText("With player markets"));
    fireEvent.click(screen.getByText("With player markets"));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("group", { name: "Keep the matches" })).not.toBeInTheDocument();
  });
});
