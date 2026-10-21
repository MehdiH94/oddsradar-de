import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WelcomeNote } from "./WelcomeNote";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("WelcomeNote", () => {
  it("explains the value bets, the surebets and the freebets, and how to send feedback", () => {
    render(<WelcomeNote />);
    const note = screen.getByRole("complementary", { name: /Willkommen bei/ });
    expect(note).toHaveTextContent("Value Bets");
    expect(note).toHaveTextContent("Surebets");
    expect(screen.getByRole("link", { name: "Freebets" })).toHaveAttribute("href", "/freebets");
    expect(note).toHaveTextContent("Feedback");
    expect(screen.getByRole("link", { name: "unserem Discord" })).toHaveAttribute("href", "https://discord.gg/VypnxkRMc");
  });

  it("stays closed once closed, on the next visit too", () => {
    const { unmount } = render(<WelcomeNote />);
    fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    unmount();
    render(<WelcomeNote />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("still shows, and still closes, when the browser refuses its storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<WelcomeNote />);
    fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
