import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthContext, type AuthValue } from "../auth/AuthContext";
import { AppHeader } from "./AppHeader";

describe("AppHeader", () => {
  it("says when the odds were last updated", () => {
    render(<AppHeader lastUpdated={new Date(2026, 8, 29, 10, 42)} refreshing={false} failed={false} onRefresh={() => {}} />);

    expect(screen.getByRole("status")).toHaveTextContent("Aktualisiert um 10:42");
  });

  it("says so when the last update failed", () => {
    render(<AppHeader lastUpdated={new Date(2026, 8, 29, 10, 42)} refreshing={false} failed onRefresh={() => {}} />);

    expect(screen.getByRole("status")).toHaveTextContent("Aktualisierung fehlgeschlagen");
  });

  it("asks for fresh odds, except while some are already on their way", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<AppHeader lastUpdated={null} refreshing={false} failed={false} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: "Quoten aktualisieren" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(<AppHeader lastUpdated={null} refreshing failed={false} onRefresh={onRefresh} />);
    expect(screen.getByRole("button", { name: "Quoten aktualisieren" })).toBeDisabled();
  });

  describe("the administration link", () => {
    const withRole = (role: "user" | "admin"): AuthValue => ({
      status: "authenticated",
      user: { id: "u1", email: "ada@example.com", role },
      login: async () => {},
      logout: async () => {},
    });
    const renderAs = (value: AuthValue) =>
      render(
        <AuthContext.Provider value={value}>
          <AppHeader lastUpdated={null} refreshing={false} failed={false} onRefresh={() => {}} />
        </AuthContext.Provider>
      );

    it("leads an admin to the administration", () => {
      renderAs(withRole("admin"));
      expect(screen.getByRole("link", { name: "Administration" })).toHaveAttribute("href", "/admin");
    });

    it("offers the feedback button to a signed-in account, not to a visitor", () => {
      const { unmount } = renderAs(withRole("user"));
      expect(screen.getByRole("button", { name: "Feedback senden" })).toBeInTheDocument();
      unmount();
      render(<AppHeader lastUpdated={null} refreshing={false} failed={false} onRefresh={() => {}} />);
      expect(screen.queryByRole("button", { name: "Feedback senden" })).not.toBeInTheDocument();
    });

    it("is not offered to an ordinary account, nor to a visitor", () => {
      renderAs(withRole("user"));
      expect(screen.queryByRole("link", { name: "Administration" })).not.toBeInTheDocument();
    });
  });
});
