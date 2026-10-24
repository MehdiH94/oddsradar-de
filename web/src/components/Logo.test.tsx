import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Logo } from "./Logo";
import favicon from "../../public/favicon.svg?raw";

describe("Logo", () => {
  it("is OddsBlitzer's bolt in a ring, decorative, and the favicon draws the same", () => {
    const svg = render(<Logo />).container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    const bolt = svg.querySelector("path")!.getAttribute("d")!;
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    expect(favicon).toContain(`d="${bolt}"`);
    expect(favicon).not.toMatch(/A13 13/);
  });
});
