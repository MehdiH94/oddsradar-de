import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SportTabs } from "./SportTabs";

// A sport's chip sits in an item (with its star), in the scrolling row. The
// pinned one has no item: its holder is the element before the row.
const itemOf = (name: string) => screen.getByRole("radio", { name }).closest("label")!.parentElement!;
const rowOf = (name: string) => itemOf(name).parentElement!;

describe("SportTabs", () => {
  it("offers one choice per sport, named for people, the current one checked", () => {
    render(<SportTabs sports={["football", "hockey sur glace"]} value="hockey sur glace" onChange={() => {}} />);

    expect(screen.getByRole("group", { name: "Sportart" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Fußball" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Eishockey" })).toBeChecked();
  });

  it("reports the sport picked", () => {
    const onChange = vi.fn();
    render(<SportTabs sports={["football", "tennis"]} value="football" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "Tennis" }));

    expect(onChange).toHaveBeenCalledWith("tennis");
  });

  describe("the pinned choice", () => {
    it("is there before any sport is", () => {
      const onChange = vi.fn();
      render(<SportTabs sports={[]} pinned="value-bets" value="football" onChange={onChange} />);

      expect(screen.getByRole("radio", { name: "Value Bets" })).not.toBeChecked();
      fireEvent.click(screen.getByRole("radio", { name: "Value Bets" }));
      expect(onChange).toHaveBeenCalledWith("value-bets");
    });

    it("comes first, in the same group of choices, out of the scrolling row", () => {
      render(<SportTabs sports={["football", "tennis"]} pinned="value-bets" value="value-bets" onChange={() => {}} />);

      const pinned = screen.getByRole("radio", { name: "Value Bets" });
      const football = screen.getByRole("radio", { name: "Fußball" });
      expect(pinned).toBeChecked();
      expect(pinned.compareDocumentPosition(football) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(pinned).toHaveAttribute("name", football.getAttribute("name"));
      expect(itemOf("Value Bets")).not.toBe(rowOf("Fußball"));
      expect(rowOf("Fußball")).toBe(rowOf("Tennis"));
      expect(rowOf("Fußball")).not.toContainElement(pinned);
    });

    it("is left out when none is pinned", () => {
      render(<SportTabs sports={["football"]} value="football" onChange={() => {}} />);

      expect(screen.queryByRole("radio", { name: "Value Bets" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(1);
    });
  });

  describe("the favorites", () => {
    const sports = ["basketball", "football", "golf", "tennis"];
    const star = (name: string) => screen.getByRole("button", { name: `Favorit: ${name}` });

    function renderTabs(props: Partial<ComponentProps<typeof SportTabs>> = {}) {
      const onChange = vi.fn();
      const onToggleFavorite = vi.fn();
      render(
        <SportTabs
          sports={sports}
          pinned="value-bets"
          value="football"
          onChange={onChange}
          favorites={[]}
          onToggleFavorite={onToggleFavorite}
          {...props}
        />,
      );
      return { onChange, onToggleFavorite };
    }

    it("come right after the pinned choice, ahead of the other sports, in the order they were starred", () => {
      renderTabs({ favorites: ["tennis", "basketball"] });

      expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual([
        "value-bets",
        "tennis",
        "basketball",
        "football",
        "golf",
      ]);
    });

    it("have a star each, and so has every other sport but the pinned choice", () => {
      renderTabs({ favorites: ["tennis"] });

      expect(screen.getAllByRole("button", { name: /^Favorit: / })).toHaveLength(sports.length);
      expect(screen.queryByRole("button", { name: "Favorit: Value Bets" })).not.toBeInTheDocument();
    });

    it("show which sports are favorites", () => {
      renderTabs({ favorites: ["tennis"] });

      expect(star("Tennis")).toHaveAttribute("aria-pressed", "true");
      expect(star("Golf")).toHaveAttribute("aria-pressed", "false");
    });

    it("are starred without the sport being picked", () => {
      const { onChange, onToggleFavorite } = renderTabs();

      fireEvent.click(star("Golf"));

      expect(onToggleFavorite).toHaveBeenCalledWith("golf");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("close the other stars at the limit, but still let a favorite go", () => {
      renderTabs({ favorites: ["tennis", "basketball", "golf"], canAddFavorite: false });

      expect(star("Fußball")).toBeDisabled();
      expect(star("Fußball")).toHaveAttribute("title", "Höchstens 3 Favoriten");
      expect(star("Tennis")).toBeEnabled();
    });

    it("leave the stars out when nothing is said to do with them", () => {
      render(<SportTabs sports={sports} value="football" onChange={() => {}} />);

      expect(screen.queryByRole("button", { name: /^Favorit: / })).not.toBeInTheDocument();
    });

    it("keep the tab order short: only the star of the chosen sport is in it", () => {
      renderTabs({ favorites: ["tennis"] });

      expect(star("Fußball")).toHaveAttribute("tabindex", "0");
      expect(star("Tennis")).toHaveAttribute("tabindex", "-1");
      expect(star("Golf")).toHaveAttribute("tabindex", "-1");
    });

    describe("moving the chips", () => {
      const scrollIntoView = vi.fn();

      // jsdom has no scrollIntoView.
      beforeEach(() => {
        scrollIntoView.mockClear();
        Object.defineProperty(Element.prototype, "scrollIntoView", {
          configurable: true,
          writable: true,
          value: scrollIntoView,
        });
      });
      afterEach(() => {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      });

      it("takes the row back to its start when a sport is starred: that is where the favorites are", () => {
        const props = { sports, value: "football", onChange: () => {}, onToggleFavorite: () => {} };
        const { rerender } = render(<SportTabs {...props} favorites={[]} />);
        const scrollTo = vi.fn();
        rowOf("Fußball").scrollTo = scrollTo;
        scrollIntoView.mockClear();

        fireEvent.click(star("Golf"));
        rerender(<SportTabs {...props} favorites={["golf"]} />);

        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 0 }));
        expect(scrollIntoView).not.toHaveBeenCalled();
      });

      it("follows a chip that was unstarred back to its place among the sports", () => {
        const props = { sports, value: "football", onChange: () => {}, onToggleFavorite: () => {} };
        const { rerender } = render(<SportTabs {...props} favorites={["golf"]} />);
        const scrollTo = vi.fn();
        rowOf("Fußball").scrollTo = scrollTo;
        scrollIntoView.mockClear();

        fireEvent.click(star("Golf"));
        rerender(<SportTabs {...props} favorites={[]} />);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
        expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("radio", { name: "Golf" }).closest("label"));
        expect(scrollTo).not.toHaveBeenCalled();
      });

      it("leaves the row where it is while the chosen sport changes", () => {
        const props = { sports, onChange: () => {}, onToggleFavorite: () => {} };
        const { rerender } = render(<SportTabs {...props} value="football" favorites={["golf"]} />);
        scrollIntoView.mockClear();

        // Not a star's doing: the chosen sport moves, and only that scrolls.
        rerender(<SportTabs {...props} value="tennis" favorites={["golf"]} />);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("radio", { name: "Tennis" }).closest("label"));
      });

      it("does not pull the row back to the chosen sport while it is scrolled by hand", () => {
        render(<SportTabs sports={sports} value="golf" onChange={() => {}} />);
        const row = rowOf("Golf");
        scrollIntoView.mockClear();
        Object.defineProperty(row, "scrollLeft", { configurable: true, value: 300 });
        Object.defineProperty(row, "clientWidth", { configurable: true, value: 400 });
        Object.defineProperty(row, "scrollWidth", { configurable: true, value: 1000 });

        fireEvent.scroll(row);

        expect(scrollIntoView).not.toHaveBeenCalled();
      });
    });
  });

  describe("the mouse on the row", () => {
    const sports = ["football", "tennis", "basketball", "rugby", "handball", "volley-ball"];

    // jsdom lays nothing out: give the row a size, and a scroll position that
    // stays inside it, as a browser's does.
    function layOut(row: HTMLElement, { scrollLeft = 0, clientWidth = 400, scrollWidth = 1000 } = {}) {
      let left = scrollLeft;
      Object.defineProperty(row, "clientWidth", { configurable: true, value: clientWidth });
      Object.defineProperty(row, "scrollWidth", { configurable: true, value: scrollWidth });
      Object.defineProperty(row, "scrollLeft", {
        configurable: true,
        get: () => left,
        set: (value: number) => {
          left = Math.min(Math.max(value, 0), scrollWidth - clientWidth);
        },
      });
    }

    function renderRow(props: { pinned?: string } = {}) {
      const onChange = vi.fn();
      render(<SportTabs sports={sports} value="football" onChange={onChange} {...props} />);
      return { row: rowOf("Fußball"), onChange };
    }

    const chip = (name: string) => screen.getByRole("radio", { name }).closest("label")!;

    describe("the wheel", () => {
      // fireEvent returns false when the page's own scroll was cancelled.
      it("scrolls the row sideways, not the page", () => {
        const { row } = renderRow();
        layOut(row, { scrollLeft: 100 });

        expect(fireEvent.wheel(chip("Tennis"), { deltaY: 120 })).toBe(false);
        expect(row.scrollLeft).toBe(220);
        expect(fireEvent.wheel(chip("Tennis"), { deltaY: -50 })).toBe(false);
        expect(row.scrollLeft).toBe(170);
      });

      it("keeps the wheel at the ends of the row: the page doesn't scroll instead", () => {
        const { row } = renderRow();
        layOut(row, { scrollLeft: 0 });
        expect(fireEvent.wheel(row, { deltaY: -100 })).toBe(false);
        expect(row.scrollLeft).toBe(0);

        layOut(row, { scrollLeft: 600 });
        expect(fireEvent.wheel(row, { deltaY: 100 })).toBe(false);
        expect(row.scrollLeft).toBe(600);
      });

      it("counts a wheel that reports lines, not pixels", () => {
        const { row } = renderRow();
        layOut(row);

        fireEvent.wheel(row, { deltaY: 3, deltaMode: 1 });

        expect(row.scrollLeft).toBe(48);
      });

      it("works over the pinned choice and the arrows too", () => {
        const { row } = renderRow({ pinned: "value-bets" });
        layOut(row, { scrollLeft: 100 });

        expect(fireEvent.wheel(chip("Value Bets"), { deltaY: 100 })).toBe(false);
        expect(row.scrollLeft).toBe(200);
        expect(fireEvent.wheel(screen.getByRole("group", { name: "Sportart" }), { deltaY: 100 })).toBe(false);
        expect(row.scrollLeft).toBe(300);
      });

      it("leaves a sideways gesture to the browser, which scrolls the row by itself", () => {
        const { row } = renderRow();
        layOut(row, { scrollLeft: 100 });

        expect(fireEvent.wheel(row, { deltaX: 80, deltaY: 5 })).toBe(true);
        expect(row.scrollLeft).toBe(100);
      });

      it("leaves the page alone when every sport fits", () => {
        const { row } = renderRow();
        layOut(row, { clientWidth: 800, scrollWidth: 800 });

        expect(fireEvent.wheel(row, { deltaY: 100 })).toBe(true);
        expect(row.scrollLeft).toBe(0);
      });
    });

    describe("dragging", () => {
      const press = (target: Element, clientX: number, init: PointerEventInit = {}) =>
        fireEvent.pointerDown(target, { pointerId: 1, pointerType: "mouse", button: 0, clientX, ...init });
      const move = (target: Element, clientX: number, init: PointerEventInit = {}) =>
        fireEvent.pointerMove(target, { pointerId: 1, pointerType: "mouse", clientX, ...init });
      const release = (target: Element, clientX: number) =>
        fireEvent.pointerUp(target, { pointerId: 1, pointerType: "mouse", clientX });

      it("moves the row with the mouse, the way the pointer goes", () => {
        const { row } = renderRow();
        layOut(row, { scrollLeft: 200 });

        press(chip("Tennis"), 300);
        move(chip("Tennis"), 250);
        expect(row.scrollLeft).toBe(250);
        move(chip("Tennis"), 330);
        expect(row.scrollLeft).toBe(170);
        release(chip("Tennis"), 330);
        move(chip("Tennis"), 100);
        expect(row.scrollLeft).toBe(170);
      });

      it("shows the grabbing hand while it does", () => {
        const { row } = renderRow();
        layOut(row);

        press(chip("Tennis"), 300);
        expect(row).not.toHaveAttribute("data-dragging");
        move(chip("Tennis"), 250);
        expect(row).toHaveAttribute("data-dragging");
        release(chip("Tennis"), 250);
        expect(row).not.toHaveAttribute("data-dragging");
      });

      it("does not pick the sport the drag ends on", () => {
        const { row, onChange } = renderRow();
        layOut(row);

        press(chip("Tennis"), 300);
        move(chip("Tennis"), 220);
        release(chip("Tennis"), 220);
        fireEvent.click(chip("Tennis"));

        expect(onChange).not.toHaveBeenCalled();
      });

      it("still picks a sport on a click, even a shaky one", () => {
        const { row, onChange } = renderRow();
        layOut(row);

        press(chip("Tennis"), 300);
        move(chip("Tennis"), 297);
        release(chip("Tennis"), 297);
        fireEvent.click(chip("Tennis"));

        expect(row.scrollLeft).toBe(0);
        expect(onChange).toHaveBeenCalledWith("tennis");
      });

      describe("on a star", () => {
        function renderStar() {
          const onToggleFavorite = vi.fn();
          render(<SportTabs sports={sports} value="football" onChange={() => {}} onToggleFavorite={onToggleFavorite} />);
          layOut(rowOf("Fußball"));
          return { onToggleFavorite, star: screen.getByRole("button", { name: "Favorit: Tennis" }) };
        }

        it("does not star the sport a drag ends on", () => {
          const { onToggleFavorite, star } = renderStar();

          press(star, 300);
          move(star, 220);
          release(star, 220);
          fireEvent.click(star);

          expect(onToggleFavorite).not.toHaveBeenCalled();
        });

        it("still stars it on a click, even a shaky one", () => {
          const { onToggleFavorite, star } = renderStar();

          press(star, 300);
          move(star, 297);
          release(star, 297);
          fireEvent.click(star);

          expect(onToggleFavorite).toHaveBeenCalledWith("tennis");
        });
      });

      it("does not swallow the click of the next press when a drag ended without one", () => {
        const { row, onChange } = renderRow();
        layOut(row);

        press(chip("Tennis"), 300);
        move(chip("Tennis"), 220);
        release(chip("Tennis"), 220);
        press(chip("Rugby"), 100);
        release(chip("Rugby"), 100);
        fireEvent.click(chip("Rugby"));

        expect(onChange).toHaveBeenCalledWith("rugby");
      });

      it("leaves the touch screen to its own swipe, and the other buttons to their menus", () => {
        const { row } = renderRow();
        layOut(row, { scrollLeft: 200 });

        press(chip("Tennis"), 300, { pointerType: "touch" });
        move(chip("Tennis"), 200, { pointerType: "touch" });
        expect(row.scrollLeft).toBe(200);

        release(chip("Tennis"), 200);
        press(chip("Tennis"), 300, { button: 2 });
        move(chip("Tennis"), 200);
        expect(row.scrollLeft).toBe(200);
      });
    });
  });

  describe("arrows to scroll the row", () => {
    const sports = ["football", "tennis", "basketball", "rugby", "handball", "volley-ball"];

    // jsdom lays nothing out: give the row a size and a scroll position.
    function layOut(row: HTMLElement, { scrollLeft, clientWidth, scrollWidth }: Record<string, number>) {
      Object.defineProperty(row, "scrollLeft", { configurable: true, value: scrollLeft });
      Object.defineProperty(row, "clientWidth", { configurable: true, value: clientWidth });
      Object.defineProperty(row, "scrollWidth", { configurable: true, value: scrollWidth });
      fireEvent.scroll(row);
    }

    // The row is what holds the sports' chips.
    function renderRow() {
      render(<SportTabs sports={sports} value="football" onChange={() => {}} />);
      return rowOf("Fußball");
    }

    const arrow = (name: string) => screen.queryByRole("button", { name });

    it("shows none when every sport fits", () => {
      const row = renderRow();
      layOut(row, { scrollLeft: 0, clientWidth: 800, scrollWidth: 800 });

      expect(arrow("Vorherige Sportarten")).not.toBeInTheDocument();
      expect(arrow("Weitere Sportarten")).not.toBeInTheDocument();
    });

    it("shows each one only while sports are hidden on its side", () => {
      const row = renderRow();

      layOut(row, { scrollLeft: 0, clientWidth: 400, scrollWidth: 1000 });
      expect(arrow("Vorherige Sportarten")).not.toBeInTheDocument();
      expect(arrow("Weitere Sportarten")).toBeInTheDocument();

      layOut(row, { scrollLeft: 300, clientWidth: 400, scrollWidth: 1000 });
      expect(arrow("Vorherige Sportarten")).toBeInTheDocument();
      expect(arrow("Weitere Sportarten")).toBeInTheDocument();

      layOut(row, { scrollLeft: 600, clientWidth: 400, scrollWidth: 1000 });
      expect(arrow("Vorherige Sportarten")).toBeInTheDocument();
      expect(arrow("Weitere Sportarten")).not.toBeInTheDocument();
    });

    it("scrolls most of a width each way", () => {
      const row = renderRow();
      const scrollBy = vi.fn();
      row.scrollBy = scrollBy;
      layOut(row, { scrollLeft: 300, clientWidth: 400, scrollWidth: 1000 });

      fireEvent.click(arrow("Weitere Sportarten")!);
      fireEvent.click(arrow("Vorherige Sportarten")!);

      expect(scrollBy).toHaveBeenNthCalledWith(1, expect.objectContaining({ left: 320 }));
      expect(scrollBy).toHaveBeenNthCalledWith(2, expect.objectContaining({ left: -320 }));
    });

    it("keeps them out of the tab order: the arrow keys already move between sports", () => {
      const row = renderRow();
      layOut(row, { scrollLeft: 300, clientWidth: 400, scrollWidth: 1000 });

      expect(arrow("Vorherige Sportarten")).toHaveAttribute("tabindex", "-1");
      expect(arrow("Weitere Sportarten")).toHaveAttribute("tabindex", "-1");
    });
  });
});
