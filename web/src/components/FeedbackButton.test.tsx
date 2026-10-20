import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeedbackButton } from "./FeedbackButton";

const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function open() {
  render(<FeedbackButton />);
  fireEvent.click(screen.getByRole("button", { name: "Feedback senden" }));
  return screen.getByRole("dialog", { name: "Feedback senden" });
}

describe("FeedbackButton", () => {
  it("sends the message with the page it was written on, then thanks the tester", async () => {
    window.history.replaceState(null, "", "/odds?sport=tennis");
    const fetchMock = vi.fn(() => reply({ ok: true }, 201));
    vi.stubGlobal("fetch", fetchMock);
    open();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Bet-at-home is missing  " } });
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Danke!");
    expect(fetchMock).toHaveBeenCalledWith("/api/feedback", expect.objectContaining({ method: "POST" }));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ message: "Bet-at-home is missing", page: "/odds?sport=tennis" });

    fireEvent.click(screen.getByRole("button", { name: "Fertig" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for a message before sending anything", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    open();
    fireEvent.submit(screen.getByRole("button", { name: "Senden" }).closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Schreib zuerst eine Nachricht.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the message to try again", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply({ message: "Zu viele Nachrichten. Versuch es später noch einmal." }, 429)));
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zu viele Nachrichten. Versuch es später noch einmal.");
    expect(screen.getByRole("textbox")).toHaveValue("Again");
  });
});
