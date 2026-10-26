import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckAtBookmaker } from "./CheckAtBookmaker";
import { ALL_BOOKMAKERS, BOOKMAKER_BRANDING } from "../bookmakers";

describe("CheckAtBookmaker", () => {
  it("opens the match's page at the bookmaker when the API gives it", () => {
    render(<CheckAtBookmaker bookmaker="betway" url="https://betway.de/de/de/sports/event/1" />);
    const link = screen.getByRole("link", { name: "Bei Betway prüfen" });
    expect(link).toHaveTextContent("Seite prüfen");
    expect(link).toHaveAttribute("href", "https://betway.de/de/de/sports/event/1");
  });

  it("opens the bookmaker's site otherwise, said as such", () => {
    render(<CheckAtBookmaker bookmaker="tipico" url={undefined} />);
    const link = screen.getByRole("link", { name: "Website von Tipico öffnen" });
    expect(link).toHaveTextContent("Zur Website");
    expect(link).toHaveAttribute("href", "https://www.tipico.de");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows nothing for a bookmaker it knows nothing of", () => {
    const { container } = render(<CheckAtBookmaker bookmaker="unknown" url={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("knows every bookmaker's site, over https", () => {
    for (const id of ALL_BOOKMAKERS) expect(BOOKMAKER_BRANDING[id]?.site, id).toMatch(/^https:\/\/[^/]+/);
  });
});
