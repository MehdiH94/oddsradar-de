import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dropdown, MenuGroup, MenuOption } from "./Dropdown";

function Colors({ closeOnPick = false, onChange = () => {} }: { closeOnPick?: boolean; onChange?: (c: string) => void }) {
  const [color, setColor] = useState("vert");
  return (
    <>
      <Dropdown label="Couleur" summary={color}>
        <MenuGroup legend="Choisir une couleur">
          {["rouge", "vert"].map((c) => (
            <MenuOption
              key={c}
              type="radio"
              name="color"
              checked={c === color}
              closeOnPick={closeOnPick}
              onChange={() => {
                setColor(c);
                onChange(c);
              }}
            >
              {c}
            </MenuOption>
          ))}
        </MenuGroup>
      </Dropdown>
      <button type="button">Ailleurs</button>
    </>
  );
}

const menuButton = () => screen.getByRole("button", { name: /^Couleur/ });

describe("Dropdown", () => {
  it("sums up the choice on a closed button", () => {
    render(<Colors />);

    expect(menuButton()).toHaveAccessibleName("Couleur: vert");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("opens on a click, onto its named options, on the current one", () => {
    render(<Colors />);

    fireEvent.click(menuButton());

    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Choisir une couleur" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "vert" })).toHaveFocus();
    expect(menuButton()).toHaveAttribute("aria-controls", screen.getByRole("group").parentElement!.id);
  });

  it("closes with Escape, back on its button", () => {
    render(<Colors />);
    fireEvent.click(menuButton());

    fireEvent.keyDown(screen.getByRole("radio", { name: "vert" }), { key: "Escape" });

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
  });

  it("closes with Enter", () => {
    render(<Colors />);
    fireEvent.click(menuButton());

    fireEvent.keyDown(screen.getByRole("radio", { name: "vert" }), { key: "Enter" });

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("closes on a click outside, and on its button again", () => {
    render(<Colors />);

    fireEvent.click(menuButton());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Ailleurs" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    fireEvent.click(menuButton());
    fireEvent.pointerDown(screen.getByRole("radio", { name: "rouge" }));
    expect(screen.getByRole("radio", { name: "rouge" })).toBeInTheDocument();
    fireEvent.click(menuButton());
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("closes when the focus leaves it", () => {
    render(<Colors />);
    fireEvent.click(menuButton());

    fireEvent.blur(screen.getByRole("radio", { name: "vert" }), {
      relatedTarget: screen.getByRole("button", { name: "Ailleurs" }),
    });

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("closes on an option picked with a click when asked to, not on one picked with the keyboard", () => {
    const onChange = vi.fn();
    render(<Colors closeOnPick onChange={onChange} />);
    fireEvent.click(menuButton());

    // The arrow keys check each radio button they go through.
    fireEvent.keyDown(screen.getByRole("radio", { name: "vert" }), { key: "ArrowUp" });
    fireEvent.click(screen.getByRole("radio", { name: "rouge" }));
    expect(onChange).toHaveBeenLastCalledWith("rouge");
    expect(screen.getByRole("radio", { name: "rouge" })).toBeChecked();

    fireEvent.pointerDown(screen.getByText("vert"));
    fireEvent.click(screen.getByText("vert"));
    expect(onChange).toHaveBeenLastCalledWith("vert");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(menuButton()).toHaveAccessibleName("Couleur: vert");
    expect(menuButton()).toHaveFocus();
  });

  it("stays open on a pick otherwise", () => {
    render(<Colors />);
    fireEvent.click(menuButton());

    fireEvent.pointerDown(screen.getByText("rouge"));
    fireEvent.click(screen.getByText("rouge"));

    expect(screen.getByRole("radio", { name: "rouge" })).toBeChecked();
  });
});
