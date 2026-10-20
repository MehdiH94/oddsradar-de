import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoadMore } from "./LoadMore";

describe("LoadMore", () => {
  it("says how many matches are shown and asks for the next ones", () => {
    const onMore = vi.fn();
    render(<LoadMore shown={40} total={52} loading={false} max={500} onMore={onMore} />);

    expect(screen.getByText(/von/).textContent).toBe("40 von 52 Spielen angezeigt");
    fireEvent.click(screen.getByRole("button", { name: "12 weitere Spiele laden" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("waits while the next ones load", () => {
    render(<LoadMore shown={20} total={52} loading max={500} onMore={() => {}} />);

    expect(screen.getByRole("button", { name: "Wird geladen…" })).toBeDisabled();
  });

  it("points to the search past its limit", () => {
    render(<LoadMore shown={500} total={613} loading={false} max={500} onMore={() => {}} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Suche nach einem Team, um die anderen Spiele zu finden.")).toBeInTheDocument();
  });
});
