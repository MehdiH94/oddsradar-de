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

  it("shows the name of a bookmaker that has no icon, and nothing beside a written name", () => {
    BOOKMAKER_BRANDING.noicon = { name: "Sans icône" };
    const { container, rerender } = render(<BookmakerLogo bookmaker="noicon" />);
    expect(screen.getByText("Sans icône")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    rerender(<BookmakerLogo bookmaker="noicon" decorative />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the id of a bookmaker it knows nothing of", () => {
    render(<BookmakerLogo bookmaker="unknown" />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("names every bookmaker, with its icon when there is one", () => {
    for (const id of ALL_BOOKMAKERS) {
      const brand = BOOKMAKER_BRANDING[id];
      expect(brand?.name).toBeTruthy();
      expect(brand?.logo === undefined || typeof brand.logo === "string").toBe(true);
    }
  });
});
