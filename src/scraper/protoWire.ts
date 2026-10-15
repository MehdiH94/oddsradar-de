//
// A generic, schema-less protobuf wire-format reader/writer. No .proto file
// is available for Betclic's internal gRPC-Web API (confirmed by inspecting
// its minified JS bundle -- see docs/superpowers/specs/2026-09-23-coteradar-improvements-design.md),
// so this walks the wire format directly (field number + wire type + value)
// instead of using a generated/typed client.

export interface ProtoField {
  fieldNumber: number;
  wireType: number; // 0 = varint, 1 = 64-bit, 2 = length-delimited, 5 = 32-bit
  varint?: bigint;
  bytes?: Buffer;
  double?: number;
  float?: number;
}

function readVarint(buf: Buffer, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  while (true) {
    const b = buf[p];
    result |= BigInt(b & 0x7f) << shift;
    p++;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, p];
}

export function decodeFields(buf: Buffer, start = 0, end: number = buf.length): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = start;
  while (pos < end) {
    const [tag, afterTag] = readVarint(buf, pos);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    pos = afterTag;

    if (wireType === 0) {
      const [value, after] = readVarint(buf, pos);
      fields.push({ fieldNumber, wireType, varint: value });
      pos = after;
    } else if (wireType === 1) {
      fields.push({ fieldNumber, wireType, double: buf.readDoubleLE(pos) });
      pos += 8;
    } else if (wireType === 5) {
      fields.push({ fieldNumber, wireType, float: buf.readFloatLE(pos) });
      pos += 4;
    } else if (wireType === 2) {
      const [len, afterLen] = readVarint(buf, pos);
      const dataStart = afterLen;
      const dataEnd = afterLen + Number(len);
      fields.push({ fieldNumber, wireType, bytes: buf.subarray(dataStart, dataEnd) });
      pos = dataEnd;
    } else {
      // Wire types 3/4 (deprecated start/end group) are not used by any
      // message observed in captured traffic -- fail loudly rather than
      // silently misparsing the rest of the buffer.
      throw new Error(`protoWire: unsupported wire type ${wireType} at byte ${pos}`);
    }
  }
  return fields;
}

export function fieldString(f: ProtoField): string {
  if (f.bytes === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not length-delimited`);
  return f.bytes.toString("utf8");
}

export function fieldMessage(f: ProtoField): ProtoField[] {
  if (f.bytes === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not length-delimited`);
  return decodeFields(f.bytes);
}

export function fieldVarintNumber(f: ProtoField): number {
  if (f.varint === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not a varint`);
  return Number(f.varint);
}

export function fieldDouble(f: ProtoField): number {
  if (f.double === undefined) throw new Error(`protoWire: field ${f.fieldNumber} is not a 64-bit value`);
  return f.double;
}

// --- writer (for building Betclic request messages) ---

function writeVarint(n: number | bigint): Buffer {
  const bytes: number[] = [];
  let v = BigInt(n);
  while (true) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) {
      bytes.push(b | 0x80);
    } else {
      bytes.push(b);
      break;
    }
  }
  return Buffer.from(bytes);
}

function writeTag(fieldNumber: number, wireType: number): Buffer {
  return writeVarint((fieldNumber << 3) | wireType);
}

export function encodeStringField(fieldNumber: number, value: string): Buffer {
  const strBuf = Buffer.from(value, "utf8");
  return Buffer.concat([writeTag(fieldNumber, 2), writeVarint(strBuf.length), strBuf]);
}

export function encodeVarintField(fieldNumber: number, value: number | bigint): Buffer {
  return Buffer.concat([writeTag(fieldNumber, 0), writeVarint(value)]);
}
