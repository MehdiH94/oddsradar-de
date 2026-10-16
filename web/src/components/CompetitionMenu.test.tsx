import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CompetitionMenu } from "./CompetitionMenu";

const FOOTBALL = [
  "Bundesliga",
  "Bundesliga 2",
  "Championship",
  "Coupe de France",
  "Eredivisie",
  "Ligue 1",
  "Ligue 2",
  "Premier League",
  "Serie A",
  "Super Lig",
];

const open = (name = "Competition: All") => fireEvent.click(screen.getByRole("button", { name }));
const radios = () => screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent);
const pick = (name: string) => {
  fireEvent.pointerDown(screen.getByText(name));
  fireEvent.click(screen.getByText(name));
};

describe("CompetitionMenu", () => {
  it("sums up the current competition, or all of them", () => {
    const { rerender } = render(<CompetitionMenu sport="football" value="" competitions={["Ligue 1"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Competition: All" })).toBeInTheDocument();

    rerender(<CompetitionMenu sport="football" value="Ligue 1" competitions={["Ligue 1"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Competition: Ligue 1" })).toBeInTheDocument();
  });

  it("opens on all, the favorites in order, then the others alphabetically, the current one checked", () => {
    render(<CompetitionMenu sport="football" value="Ligue 1" competitions={["Coupe de France", "Ligue 1", "Serie A", "Premier League"]} onChange={() => {}} />);

    open("Competition: Ligue 1");
    expect(radios()).toEqual(["All competitions", "Premier League", "Serie A", "Ligue 1", "Coupe de France"]);
    expect(screen.getByRole("radio", { name: "Ligue 1" })).toBeChecked();
    expect(screen.getByRole("group", { name: "Top competitions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Other competitions" })).toBeInTheDocument();
  });

  it("is folded to the favorites and three others, with a button to show them all and to fold again", () => {
    render(<CompetitionMenu sport="football" value="" competitions={FOOTBALL} onChange={() => {}} />);

    open();
    expect(radios()).toEqual([
      "All competitions",
      "Bundesliga",
      "Premier League",
      "Serie A",
      "Ligue 1",
      "Bundesliga 2",
      "Championship",
      "Coupe de France",
    ]);
    const more = screen.getByRole("button", { name: "Show all 10 competitions" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);
    expect(radios()).toHaveLength(11);
    expect(radios().slice(5)).toEqual(["Bundesliga 2", "Championship", "Coupe de France", "Eredivisie", "Ligue 2", "Super Lig"]);
    const less = screen.getByRole("button", { name: "Show fewer" });
    expect(less).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(less);
    expect(radios()).toHaveLength(8);
  });

  it("keeps the chosen competition in sight while folded", () => {
    render(<CompetitionMenu sport="football" value="Super Lig" competitions={FOOTBALL} onChange={() => {}} />);

    open("Competition: Super Lig");
    expect(radios()).toContain("Super Lig");
    expect(screen.getByRole("radio", { name: "Super Lig" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Eredivisie" })).not.toBeInTheDocument();
  });

  it("shows a short list whole, without a button", () => {
    render(<CompetitionMenu sport="football" value="" competitions={["Coupe de France", "Ligue 1"]} onChange={() => {}} />);

    open();
    expect(radios()).toEqual(["All competitions", "Ligue 1", "Coupe de France"]);
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("has no favorites outside football", () => {
    render(<CompetitionMenu sport="tennis" value="" competitions={["Ligue 1", "ATP Paris"]} onChange={() => {}} />);

    open();
    expect(radios()).toEqual(["All competitions", "ATP Paris", "Ligue 1"]);
    expect(screen.queryByRole("group", { name: "Top competitions" })).not.toBeInTheDocument();
  });

  it("searches every competition as one types, folded or not, without case or accents", () => {
    render(<CompetitionMenu sport="football" value="" competitions={FOOTBALL} onChange={() => {}} />);

    open();
    const search = screen.getByRole("searchbox", { name: "Search for a competition" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "BUNDES" } });

    expect(radios()).toEqual(["Bundesliga", "Bundesliga 2"]);
    expect(screen.queryByRole("button", { name: /Show all|Show fewer/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "super" } });
    expect(radios()).toEqual(["Super Lig"]);

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("No competition matches “zzz”.");

    fireEvent.click(screen.getByRole("button", { name: "Clear the competition search" }));
    expect(search).toHaveValue("");
    expect(radios()[0]).toBe("All competitions");
  });

  it("picks the first competition found on Enter, and the arrow goes down to the rows", () => {
    const onChange = vi.fn();
    render(<CompetitionMenu sport="football" value="" competitions={FOOTBALL} onChange={onChange} />);

    open();
    const search = screen.getByRole("searchbox", { name: "Search for a competition" });
    fireEvent.change(search, { target: { value: "ligue" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Ligue 1");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(radios().length).toBeGreaterThan(0);
    expect(within(screen.getByRole("group", { name: "Top competitions" })).getAllByRole("radio")[0]).toHaveFocus();
  });

  it("does nothing on Enter when nothing is found", () => {
    const onChange = vi.fn();
    render(<CompetitionMenu sport="football" value="" competitions={FOOTBALL} onChange={onChange} />);

    open();
    const search = screen.getByRole("searchbox", { name: "Search for a competition" });
    fireEvent.change(search, { target: { value: "zzz" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports the competition clicked, and \"\" for all of them, and closes", () => {
    const onChange = vi.fn();
    render(<CompetitionMenu sport="football" value="Ligue 1" competitions={["Coupe de France", "Ligue 1"]} onChange={onChange} />);

    open("Competition: Ligue 1");
    pick("Coupe de France");
    expect(onChange).toHaveBeenLastCalledWith("Coupe de France");
    expect(screen.queryByRole("group", { name: "Competition" })).not.toBeInTheDocument();

    open("Competition: Ligue 1");
    pick("All competitions");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("starts again folded and unsearched at each opening", () => {
    render(<CompetitionMenu sport="football" value="" competitions={FOOTBALL} onChange={() => {}} />);

    open();
    fireEvent.click(screen.getByRole("button", { name: "Show all 10 competitions" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ere" } });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    open();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Show all 10 competitions" })).toBeInTheDocument();
  });

  it("lists the current competition even when the list has no more of it, so that it can be undone", () => {
    render(<CompetitionMenu sport="football" value="Ligue 2" competitions={["Ligue 1"]} onChange={() => {}} />);

    open("Competition: Ligue 2");
    expect(screen.getByRole("radio", { name: "Ligue 2" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Ligue 1" })).not.toBeChecked();
  });
});
