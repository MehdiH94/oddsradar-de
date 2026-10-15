import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pagination } from "./Pagination";
import { pageWindow } from "../pageWindow";

describe("pageWindow", () => {
  it("offers the first, the last and the current page with its neighbours", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(3, 31)).toEqual([1, 2, 3, 4, "gap", 31]);
    expect(pageWindow(16, 31)).toEqual([1, "gap", 15, 16, 17, "gap", 31]);
    expect(pageWindow(31, 31)).toEqual([1, "gap", 30, 31]);
  });

  it("shows a lone hidden page rather than a gap for it", () => {
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, "gap", 10]);
  });
});

describe("Pagination", () => {
  it("says which results are shown and marks the current page", () => {
    render(<Pagination page={2} pageSize={20} total={613} onChange={() => {}} />);

    expect(screen.getByText("21–40 sur 613")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Page 1" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Page 31" })).toBeInTheDocument();
  });

  it("moves page by page, and can't go before the first or past the last", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={20} total={50} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(onChange).toHaveBeenCalledWith(2);

    rerender(<Pagination page={3} pageSize={20} total={50} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
    expect(screen.getByText("41–50 sur 50")).toBeInTheDocument();
  });
});
