import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppNav } from "./AppNav";
import type { Promo } from "../promos/promosApi";

const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const sitePromo = (id: number, over: Partial<Promo> = {}): Promo => ({
  id,
  source: "site",
  bookmaker: "neobet",
  title: `Promo ${id}`,
  details: "",
  url: null,
  endsAt: null,
  foundAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  mine: false,
  takenAt: null,
  ...over,
});

describe("AppNav's new promotions count", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the promotions and counts the open new ones on the Promos entry", async () => {
    const fetchMock = vi.fn(() =>
      reply({
        promos: [
          sitePromo(1),
          sitePromo(2),
          sitePromo(3, { takenAt: new Date().toISOString() }),
          sitePromo(4, { foundAt: "2026-01-01T00:00:00.000Z" }),
          sitePromo(5, { source: "manual", mine: true }),
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AppNav view="matches" onChange={() => {}} placement="bar" />);
    expect(await screen.findByRole("radio", { name: "Promos, 2 neu" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/promos");
  });

  it("shows no count when none is new or the read fails", async () => {
    const fetchMock = vi.fn(() => reply({}, 401));
    vi.stubGlobal("fetch", fetchMock);
    render(<AppNav view="matches" onChange={() => {}} placement="header" />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("radio", { name: "Promos" })).toBeInTheDocument();
  });

  it("takes the count the Promos page gives, without reading it again", () => {
    const fetchMock = vi.fn(() => reply({ promos: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AppNav view="promos" onChange={() => {}} placement="header" newPromos={3} />);
    expect(screen.getByRole("radio", { name: "Promos, 3 neu" })).toBeChecked();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
