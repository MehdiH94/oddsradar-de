import { describe, it, expect } from "vitest";
import {
  decodeFields,
  fieldString,
  fieldMessage,
  fieldVarintNumber,
  fieldDouble,
  encodeStringField,
  encodeVarintField,
} from "../../src/scraper/protoWire";

describe("protoWire", () => {
  it("decodes a real captured request message (sport=football, locale=fr, limit=20)", () => {
    // Captured live from the Betclic MatchService endpoint -- see
    // docs/superpowers/specs/2026-09-23-coteradar-improvements-design.md.
    const bytes = Buffer.from("0a08666f6f7462616c6c1a0266722814", "hex");
    const fields = decodeFields(bytes);

    expect(fields).toHaveLength(3);
    expect(fieldString(fields[0])).toBe("football");
    expect(fields[0].fieldNumber).toBe(1);
    expect(fieldString(fields[1])).toBe("fr");
    expect(fields[1].fieldNumber).toBe(3);
    expect(fieldVarintNumber(fields[2])).toBe(20);
    expect(fields[2].fieldNumber).toBe(5);
  });

  it("decodes a nested message (wire type 2 containing more fields)", () => {
    // field 1 (varint)=7, wrapped inside field 2 (length-delimited)
    const inner = Buffer.concat([encodeVarintField(1, 7)]);
    const outer = Buffer.concat([encodeStringFieldRaw(2, inner)]);
    const fields = decodeFields(outer);

    expect(fields).toHaveLength(1);
    const nested = fieldMessage(fields[0]);
    expect(fieldVarintNumber(nested[0])).toBe(7);
  });

  it("decodes a 64-bit float (wire type 1)", () => {
    // Real captured odds price field: tag 0x61 = field 12, wire type 1.
    const buf = Buffer.alloc(9);
    buf.writeUInt8(0x61, 0);
    buf.writeDoubleLE(2.05, 1);
    const fields = decodeFields(buf);

    expect(fields).toHaveLength(1);
    expect(fields[0].fieldNumber).toBe(12);
    expect(fieldDouble(fields[0])).toBe(2.05);
  });

  it("round-trips encodeStringField/encodeVarintField through decodeFields", () => {
    const bytes = Buffer.concat([encodeStringField(1, "tennis"), encodeVarintField(5, 1000)]);
    const fields = decodeFields(bytes);

    expect(fieldString(fields[0])).toBe("tennis");
    expect(fieldVarintNumber(fields[1])).toBe(1000);
  });
});

// Test-only helper: encodeStringField takes a UTF-8 string, but the nested-message
// test needs to wrap already-encoded bytes -- not a real protoWire export, since
// no real caller needs to write a raw already-encoded submessage directly.
function encodeStringFieldRaw(fieldNumber: number, raw: Buffer): Buffer {
  const tag = Buffer.from([((fieldNumber << 3) | 2) & 0xff]);
  const len = Buffer.from([raw.length]);
  return Buffer.concat([tag, len, raw]);
}
