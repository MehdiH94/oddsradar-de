import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  const renderSheet = (onClose = vi.fn()) =>
    render(
      <Sheet id="s" title="Filters" open onClose={onClose} footer={<button type="button">Show</button>}>
        <label>
          <input type="checkbox" /> LeoVegas
        </label>
      </Sheet>
    );

  it("is a modal dialog named by its title, and takes the focus", () => {
    renderSheet();

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("keeps Tab inside it", () => {
    renderSheet();
    const close = screen.getByRole("button", { name: "Schließen" });
    const last = screen.getByRole("button", { name: "Show" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("closes with Escape, its close button, or a tap beside it", () => {
    const onClose = vi.fn();
    renderSheet(onClose);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.click(document.querySelector("[aria-hidden='true']")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("renders nothing while closed", () => {
    render(
      <Sheet id="s" title="Filters" open={false} onClose={() => {}}>
        x
      </Sheet>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
