import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { GamblingBanner } from "./GamblingBanner";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--banner-height");
});

describe("GamblingBanner", () => {
  it("shows the responsible gambling notice", () => {
    render(<GamblingBanner />);

    const banner = screen.getByRole("complementary", { name: "Verantwortungsvolles Spielen" });
    expect(banner).toHaveTextContent(
      "18+. Glücksspiel kann süchtig machen: Geldverlust, Konflikte in der Familie, Sucht… " +
        "Hilfe unter check-dein-spiel.de (BZgA, kostenlose Hotline 0800 1 37 27 00)",
    );
  });

  it("shows the sports betting message on a page about a match", () => {
    render(<GamblingBanner sportsBetting />);

    expect(screen.getByRole("complementary")).toHaveTextContent(
      "18+. Sportwetten können süchtig machen: Hör rechtzeitig auf. " +
        "Hilfe unter check-dein-spiel.de (BZgA, kostenlose Hotline 0800 1 37 27 00)",
    );
  });

  it("links the whole message to the federal help on gambling addiction", () => {
    render(<GamblingBanner />);

    const link = screen.getByRole("link", { name: /Glücksspiel kann süchtig machen/ });
    expect(link).toHaveAttribute("href", "https://www.check-dein-spiel.de");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shares its height with the bars that stick under it, and takes it back when it goes", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(48);

    const { unmount } = render(<GamblingBanner />);
    expect(document.documentElement.style.getPropertyValue("--banner-height")).toBe("48px");
    expect(observe).toHaveBeenCalled();

    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--banner-height")).toBe("");
  });
});
