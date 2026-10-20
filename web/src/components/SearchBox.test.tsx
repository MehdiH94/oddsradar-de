import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchBox } from "./SearchBox";

describe("SearchBox", () => {
  it("offers the suggestions it is given", () => {
    render(<SearchBox value="ps" suggestions={["PSG - OM", "PSG - Lens"]} onChange={() => {}} />);

    const options = [...document.querySelectorAll("#event-suggestions option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["PSG - OM", "PSG - Lens"]);
  });

  it("clears the search with its button, shown only when there is something to clear", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchBox value="" suggestions={[]} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Suche löschen" })).not.toBeInTheDocument();

    rerender(<SearchBox value="psg" suggestions={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Suche löschen" }));

    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByRole("combobox", { name: "Spiel suchen" })).toHaveFocus();
  });

  it("jumps to the search with /, but not while typing elsewhere", () => {
    render(
      <>
        <input aria-label="Autre champ" />
        <SearchBox value="" suggestions={[]} onChange={() => {}} />
      </>
    );
    const search = screen.getByRole("combobox", { name: "Spiel suchen" });

    fireEvent.keyDown(screen.getByLabelText("Autre champ"), { key: "/" });
    expect(search).not.toHaveFocus();

    fireEvent.keyDown(document.body, { key: "/" });
    expect(search).toHaveFocus();
  });
});
