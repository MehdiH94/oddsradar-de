import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoadMore } from "./LoadMore";

describe("LoadMore", () => {
  it("says how many matches are shown and asks for the next ones", () => {
    const onMore = vi.fn();
    render(<LoadMore shown={40} total={52} loading={false} max={500} onMore={onMore} />);

    expect(screen.getByText(/of/).textContent).toBe("40 of 52 matches shown");
    fireEvent.click(screen.getByRole("button", { name: "Show 12 more matches" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("waits while the next ones load", () => {
    render(<LoadMore shown={20} total={52} loading max={500} onMore={() => {}} />);

    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("points to the search past its limit", () => {
    render(<LoadMore shown={500} total={613} loading={false} max={500} onMore={() => {}} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Search for a team to find the other matches.")).toBeInTheDocument();
  });
});
