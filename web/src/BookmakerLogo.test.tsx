import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookmakerLogo } from "./BookmakerLogo";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "./bookmakers";

describe("BookmakerLogo", () => {
  afterEach(() => {
    delete BOOKMAKER_BRANDING.noicon;
  });

  it("shows a bookmaker's icon, with its name as alt text", () => {
    render(<BookmakerLogo bookmaker="leovegas" />);
    expect(screen.getByRole("img", { name: "LeoVegas" })).toBeInTheDocument();
  });

  it("shows the initial of a bookmaker that has no icon, named for screen readers, hidden beside a written name", () => {
    BOOKMAKER_BRANDING.noicon = { name: "sans icône" };
    const { rerender } = render(<BookmakerLogo bookmaker="noicon" size={16} />);
    const badge = screen.getByRole("img", { name: "sans icône" });
    expect(badge).toHaveTextContent(/^S$/);
    expect(badge).toHaveAttribute("title", "sans icône");
    expect(badge).toHaveStyle({ width: "16px", height: "16px" });

    rerender(<BookmakerLogo bookmaker="noicon" decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("S")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the id of a bookmaker it knows nothing of", () => {
    render(<BookmakerLogo bookmaker="unknown" />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("gives every bookmaker a name and its own icon, so that each site is recognized", () => {
    for (const id of ALL_BOOKMAKERS) {
      const brand = BOOKMAKER_BRANDING[id];
      expect(brand?.name, id).toBeTruthy();
      expect(typeof brand?.logo, id).toBe("string");
    }
    const logos = ALL_BOOKMAKERS.map((id) => BOOKMAKER_BRANDING[id]!.logo);
    expect(new Set(logos).size).toBe(logos.length);
  });
});
