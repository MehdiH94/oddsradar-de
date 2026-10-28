import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReferenceNote } from "./ReferenceNote";

describe("ReferenceNote", () => {
  it("says the prices are net of the German betting tax, and where they are not", () => {
    render(<ReferenceNote />);
    const note = screen.getByText("So liest du die Quoten").closest("details")!;
    expect(note).toHaveTextContent(/Alle Quoten nach Abzug der Wettsteuer \(5\s% bzw\. 5,3\s% des Einsatzes, je nach Buchmacher\)/);
    expect(note).toHaveTextContent("20bet, Tipico und Winamax ziehen keine ab");
  });

  it("says the football 1X2's fair odds come from Pinnacle, and its control payout", () => {
    render(<ReferenceNote />);
    const note = screen.getByText("So liest du die Quoten").closest("details")!;
    expect(note).toHaveTextContent("beim Fußball-1X2 die Quote von Pinnacle");
    expect(note).toHaveTextContent(/Auszahlungsquote von mindestens 99\s%/);
  });
});
