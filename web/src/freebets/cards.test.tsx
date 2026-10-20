import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { before, exchangeCards, planCards } from "./cards";
import { BOOKMAKERS_ANSWER, CHAIN, PLAN_ONE } from "./testData";

describe("planCards", () => {
  it("makes a card of each plan, and tells the best rate by a word when it is the only one", () => {
    const cards = planCards(BOOKMAKERS_ANSWER);
    // The figures keep their unit with a non-breaking space.
    const plain = (text: string) => text.replace(/\u00a0/g, " ");
    expect(cards.map((c) => [c.rank, plain(c.rate), plain(c.cash)])).toEqual([
      [1, "59,5 %", "31,20 €"],
      [2, "52,1 %", "28,90 €"],
      [3, "50,3 %", "20,10 €"],
    ]);
    expect(cards.map((c) => c.badge?.text)).toEqual(["Beste Rate", undefined, undefined]);
    expect(cards[0].lines).toEqual(["Paris SG – Marseille"]);
    // The part of the wallet it uses.
    expect(cards[0].to).toBeCloseTo(52.4 / 55.5, 9);
  });

  it("names no best rate for a single plan, nor between equal ones", () => {
    expect(planCards({ ...BOOKMAKERS_ANSWER, plans: [PLAN_ONE] })[0].badge).toBeUndefined();
    const tie = planCards({ ...BOOKMAKERS_ANSWER, plans: [PLAN_ONE, { ...PLAN_ONE, rank: 2 }] });
    expect(tie.every((c) => c.badge === undefined)).toBe(true);
  });

  it("says how much of the wallet a plan converts", () => {
    const { container } = render(<>{planCards(BOOKMAKERS_ANSWER)[0].caption}</>);
    expect(container).toHaveTextContent("52,40 FB von 55,50 umgewandelt");
  });
});

describe("exchangeCards", () => {
  it("draws each conversion after the ones before it, and says what is left", () => {
    const cards = exchangeCards(CHAIN, 30);
    expect(cards.map((c) => c.badge?.text)).toEqual(["Durch Liquidität begrenzt", "Durch Liquidität begrenzt", "Wandelt den ganzen Rest um"]);
    expect(cards.map((c) => c.badge?.tone)).toEqual(["warning", "warning", "good"]);
    expect(cards[0].from).toBe(0);
    expect(cards[0].to).toBeCloseTo(14.12 / 30, 9);
    expect(cards[1].from).toBeCloseTo(14.12 / 30, 9);
    expect(cards[2].to).toBeCloseTo(1, 9);
    expect(cards[0].lines[0]).toBe("Auxerre");
    expect(render(<>{cards[1].caption}</>).container).toHaveTextContent("Wandelt 12,17 FB um · danach 3,71 FB übrig");
  });
});

describe("before", () => {
  it("is what is left of the wallet before a step", () => {
    expect(before(CHAIN, 0, 30)).toBe(30);
    expect(before(CHAIN, 1, 30)).toBe(15.88);
    expect(before(CHAIN, 2, 30)).toBe(3.71);
  });
});
