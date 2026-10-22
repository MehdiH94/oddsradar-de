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
});
