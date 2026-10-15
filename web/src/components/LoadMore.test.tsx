import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoadMore } from "./LoadMore";

describe("LoadMore", () => {
  it("says how many matches are shown and asks for the next ones", () => {
    const onMore = vi.fn();
    render(<LoadMore shown={40} total={52} loading={false} max={500} onMore={onMore} />);

    expect(screen.getByText(/sur/).textContent).toBe("40 sur 52 matchs affichés");
    fireEvent.click(screen.getByRole("button", { name: "Voir 12 matchs de plus" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("waits while the next ones load", () => {
    render(<LoadMore shown={20} total={52} loading max={500} onMore={() => {}} />);

    expect(screen.getByRole("button", { name: "Chargement…" })).toBeDisabled();
  });

  it("points to the search past its limit", () => {
    render(<LoadMore shown={500} total={613} loading={false} max={500} onMore={() => {}} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Cherchez une équipe pour trouver les autres matchs.")).toBeInTheDocument();
  });
});
