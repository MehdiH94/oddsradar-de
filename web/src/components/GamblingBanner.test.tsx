import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { GamblingBanner } from "./GamblingBanner";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--banner-height");
});

describe("GamblingBanner", () => {
  it("shows the warning of the arrêté du 4 mars 2026, word for word", () => {
    render(<GamblingBanner />);

    const banner = screen.getByRole("complementary", { name: "Prévention des jeux d'argent" });
    expect(banner).toHaveTextContent(
      "Les jeux d'argent et de hasard peuvent être dangereux : pertes d'argent, conflits familiaux, addiction… " +
        "Nos conseils sur joueurs-info-service.fr (09-74-75-13-13 - appel non surtaxé)",
    );
  });

  it("shows the sports betting message on a page about a match", () => {
    render(<GamblingBanner sportsBetting />);

    expect(screen.getByRole("complementary")).toHaveTextContent(
      "Parce qu'un parieur doit savoir quand quitter le jeu. " +
        "Rendez-vous sur joueurs-info-service.fr (09-74-75-13-13 - appel non surtaxé)",
    );
  });

  it("carries the Government's logo", () => {
    render(<GamblingBanner />);

    expect(screen.getByAltText(/Gouvernement/)).toBeInTheDocument();
  });

  it("links the whole message to Joueurs Info Service", () => {
    render(<GamblingBanner />);

    const link = screen.getByRole("link", { name: /jeux d'argent et de hasard peuvent être dangereux/ });
    expect(link).toHaveAttribute("href", "https://www.joueurs-info-service.fr");
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
