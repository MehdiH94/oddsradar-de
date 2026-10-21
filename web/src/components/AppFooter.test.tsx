import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppFooter } from "./AppFooter";

describe("AppFooter", () => {
  it("leads to the testers' Discord, in a new tab", () => {
    render(<AppFooter />);
    const link = screen.getByRole("link", { name: "Discord beitreten" });
    expect(link).toHaveAttribute("href", "https://discord.gg/VypnxkRMc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
