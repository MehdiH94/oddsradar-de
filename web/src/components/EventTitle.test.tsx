import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventTitle } from "./EventTitle";

const matchHref = (id: string) => `?match=${id}`;
const sportHref = (sport: string, q: string) => `?sport=${sport}&q=${q}`;

describe("EventTitle", () => {
  it("pictures the sport, named for whoever doesn't know its icon", () => {
    render(<EventTitle eventId="dmh" sport="tennis" title="Alex De Minaur - Hubert Hurkacz" />);
    const icon = screen.getByRole("img", { name: "Tennis" });
    expect(icon).toHaveTextContent("🎾");
    expect(icon).toHaveAttribute("title", "Tennis");
  });

  it("gives a sport it doesn't know yet the default icon, under its own name", () => {
    render(<EventTitle eventId="x" sport="curling" title="Suisse - Suède" />);
    expect(screen.getByRole("img", { name: "Curling" })).toHaveTextContent("🏅");
  });

  it("is plain text when there is nowhere to lead to", () => {
    render(<EventTitle eventId="dmh" sport="tennis" title="Alex De Minaur - Hubert Hurkacz" />);
    expect(screen.getByText("Alex De Minaur - Hubert Hurkacz")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("leads to the match's page, opened in place on a plain click", () => {
    const onOpenMatch = vi.fn();
    render(
      <EventTitle
        eventId="dmh"
        sport="tennis"
        title="Alex De Minaur - Hubert Hurkacz"
        matchHref={matchHref}
        onOpenMatch={onOpenMatch}
        sportHref={sportHref}
      />
    );
    const link = screen.getByRole("link", { name: "Alex De Minaur - Hubert Hurkacz" });
    expect(link).toHaveAttribute("href", "?match=dmh");
    fireEvent.click(link);
    expect(onOpenMatch).toHaveBeenCalledWith("dmh");
    // A new tab keeps the link's own way.
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { shiftKey: true });
    fireEvent.click(link, { button: 1 });
    expect(onOpenMatch).toHaveBeenCalledTimes(1);
  });

  it("opens the match's page as a plain link when nothing opens it in place", () => {
    render(<EventTitle eventId="dmh" sport="tennis" title="Alex De Minaur - Hubert Hurkacz" matchHref={matchHref} />);
    expect(screen.getByRole("link", { name: "Alex De Minaur - Hubert Hurkacz" })).toHaveAttribute("href", "?match=dmh");
  });

  it("leads to the match's page even when the event has nothing but its main market", () => {
    const onOpenMatch = vi.fn();
    const title = "Femmes - Classement Général Relais 2026/2027";
    render(
      <EventTitle eventId="relais" sport="ski de fond" title={title} matchHref={matchHref} onOpenMatch={onOpenMatch} sportHref={sportHref} />
    );
    const link = screen.getByRole("link", { name: title });
    expect(link).toHaveAttribute("href", "?match=relais");
    fireEvent.click(link);
    expect(onOpenMatch).toHaveBeenCalledWith("relais");
  });

  it("falls back to the sport's page when it knows no match's page", () => {
    render(<EventTitle eventId="x" sport="golf" title="Open d'Espagne" sportHref={sportHref} />);
    expect(screen.getByRole("link", { name: "Open d'Espagne" })).toHaveAttribute("href", "?sport=golf&q=Open d'Espagne");
  });
});
