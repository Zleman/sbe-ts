import { describe, it, expect } from 'vitest';
import { MessageFlyweight } from '../src/flyweight.js';
import { GroupIterator, GroupWriter } from '../src/group.js';
import type { GroupEntry } from '../src/group.js';

// Hand-coded encoder/decoder pairs mirroring what sbe-ts-cli generates.

// --- Primitive fields roundtrip ---

class PrimEncoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 16;
  setId(v: number): this { this.setUint32(0, v); return this; }
  setPrice(v: bigint): this { this.setInt64(4, v); return this; }
  setFlags(v: number): this { this.setUint32(12, v); return this; }
}

class PrimDecoder extends MessageFlyweight {
  id(): number { return this.getUint32(0); }
  price(): bigint { return this.getInt64(4); }
  flags(): number { return this.getUint32(12); }
}

describe('roundtrip — primitive fields', () => {
  it('uint32 field roundtrips', () => {
    const buf = new ArrayBuffer(PrimEncoder.BLOCK_LENGTH);
    new PrimEncoder(buf, 0).setId(0xdeadbeef);
    expect(new PrimDecoder(buf, 0).id()).toBe(0xdeadbeef);
  });

  it('int64 field roundtrips', () => {
    const buf = new ArrayBuffer(PrimEncoder.BLOCK_LENGTH);
    new PrimEncoder(buf, 0).setPrice(-9007199254740993n);
    expect(new PrimDecoder(buf, 0).price()).toBe(-9007199254740993n);
  });

  it('multiple fields coexist at correct offsets', () => {
    const buf = new ArrayBuffer(PrimEncoder.BLOCK_LENGTH);
    new PrimEncoder(buf, 0).setId(1).setPrice(2n).setFlags(3);
    const dec = new PrimDecoder(buf, 0);
    expect(dec.id()).toBe(1);
    expect(dec.price()).toBe(2n);
    expect(dec.flags()).toBe(3);
  });

  it('wrap() repoints decoder to a different buffer', () => {
    const buf1 = new ArrayBuffer(PrimEncoder.BLOCK_LENGTH);
    const buf2 = new ArrayBuffer(PrimEncoder.BLOCK_LENGTH);
    new PrimEncoder(buf1, 0).setId(10);
    new PrimEncoder(buf2, 0).setId(20);
    const dec = new PrimDecoder(buf1, 0);
    expect(dec.id()).toBe(10);
    dec.wrap(buf2, 0);
    expect(dec.id()).toBe(20);
  });

  it('wrapOffset() advances offset within same buffer', () => {
    const buf = new ArrayBuffer(PrimEncoder.BLOCK_LENGTH * 2);
    new PrimEncoder(buf, 0).setId(111);
    new PrimEncoder(buf, PrimEncoder.BLOCK_LENGTH).setId(222);
    const dec = new PrimDecoder(buf, 0);
    expect(dec.id()).toBe(111);
    dec.wrapOffset(PrimEncoder.BLOCK_LENGTH);
    expect(dec.id()).toBe(222);
  });
});

// --- VarData roundtrip ---

class VarEncoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 4;
  private cursor = this.BLOCK_LENGTH;
  setSeq(v: number): this { this.setUint32(0, v); return this; }
  setText(data: Uint8Array): this {
    if (data.length > 0xffff) throw new RangeError('text: overflow');
    const pos = this.offset + this.cursor;
    this.view.setUint32(pos, data.length, this.littleEndian);
    new Uint8Array(this.view.buffer, pos + 4, data.length).set(data);
    this.cursor += 4 + data.length;
    return this;
  }
  private get BLOCK_LENGTH() { return VarEncoder.BLOCK_LENGTH; }
}

class VarDecoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 4;
  override wrap(buffer: ArrayBufferLike, offset: number): this {
    super.wrap(buffer, offset);
    this.cursor = VarDecoder.BLOCK_LENGTH;
    return this;
  }
  seq(): number { return this.getUint32(0); }
  text(): Uint8Array {
    const pos = this.offset + this.cursor;
    const len = this.view.getUint32(pos, this.littleEndian);
    const data = new Uint8Array(this.view.buffer, pos + 4, len);
    this.cursor += 4 + len;
    return data;
  }
}

describe('roundtrip — VarData field', () => {
  it('text bytes roundtrip correctly', () => {
    const payload = new TextEncoder().encode('hello');
    const buf = new ArrayBuffer(4 + 4 + payload.length);
    new VarEncoder(buf, 0).setSeq(99).setText(payload);
    const dec = new VarDecoder(buf, 0);
    dec.wrap(buf, 0);
    expect(dec.seq()).toBe(99);
    const result = dec.text();
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('text view is zero-copy (shares buffer)', () => {
    const payload = new TextEncoder().encode('abc');
    const buf = new ArrayBuffer(4 + 4 + payload.length);
    new VarEncoder(buf, 0).setSeq(0).setText(payload);
    const dec = new VarDecoder(buf, 0);
    dec.wrap(buf, 0);
    const view = dec.text();
    expect(view.buffer).toBe(buf);
  });
});

// --- Repeating group roundtrip ---

class FillEntry extends MessageFlyweight implements GroupEntry {
  static readonly BLOCK_LENGTH = 6;
  price(): number { return this.getUint32(0); }
  qty(): number { return this.getUint16(4); }
  setPrice(v: number): this { this.setUint32(0, v); return this; }
  setQty(v: number): this { this.setUint16(4, v); return this; }
  absoluteEnd(): number { return this.offset + FillEntry.BLOCK_LENGTH; }
}

class TradeDecoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 4;
  private static readonly _EMPTY = new ArrayBuffer(0);
  private readonly _fillEntry = new FillEntry(TradeDecoder._EMPTY, 0);
  private readonly _fillsIter = new GroupIterator(this._fillEntry);

  orderId(): number { return this.getUint32(0); }

  fills(): GroupIterator<FillEntry> {
    const hdrOff = this.offset + TradeDecoder.BLOCK_LENGTH;
    const numInGroup = this.view.getUint16(hdrOff + 2, this.littleEndian);
    return this._fillsIter.reset(this.view.buffer, hdrOff + 4, numInGroup);
  }
}

class TradeEncoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 4;
  private static readonly _EMPTY = new ArrayBuffer(0);
  private readonly _fillEntry = new FillEntry(TradeEncoder._EMPTY, 0);
  private readonly _fillsWriter = new GroupWriter(this._fillEntry);

  setOrderId(v: number): this { this.setUint32(0, v); return this; }

  fillsCount(n: number): GroupWriter<FillEntry> {
    const hdrOff = this.offset + TradeEncoder.BLOCK_LENGTH;
    this.view.setUint16(hdrOff, FillEntry.BLOCK_LENGTH, this.littleEndian);
    this.view.setUint16(hdrOff + 2, n, this.littleEndian);
    return this._fillsWriter.reset(this.view.buffer, hdrOff + 4, n);
  }
}

describe('roundtrip — repeating group', () => {
  it('writes 2 fills and reads them back', () => {
    const buf = new ArrayBuffer(TradeEncoder.BLOCK_LENGTH + 4 + 2 * FillEntry.BLOCK_LENGTH);
    const enc = new TradeEncoder(buf, 0);
    enc.setOrderId(1234);
    const writer = enc.fillsCount(2);
    writer.next().setPrice(100).setQty(10);
    writer.next().setPrice(200).setQty(20);

    const dec = new TradeDecoder(buf, 0);
    expect(dec.orderId()).toBe(1234);
    const fills: Array<{ price: number; qty: number }> = [];
    for (const e of dec.fills()) {
      fills.push({ price: e.price(), qty: e.qty() });
    }
    expect(fills).toHaveLength(2);
    expect(fills[0]!.price).toBe(100);
    expect(fills[0]!.qty).toBe(10);
    expect(fills[1]!.price).toBe(200);
    expect(fills[1]!.qty).toBe(20);
  });

  it('empty group (0 entries) roundtrips', () => {
    const buf = new ArrayBuffer(TradeEncoder.BLOCK_LENGTH + 4);
    new TradeEncoder(buf, 0).setOrderId(7).fillsCount(0);
    const dec = new TradeDecoder(buf, 0);
    expect(dec.orderId()).toBe(7);
    expect([...dec.fills()]).toHaveLength(0);
  });
});

// --- Enum field roundtrip ---

const Side = { Buy: 0, Sell: 1 } as const;
type Side = number;

class OrderEncoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 4;
  setId(v: number): this { this.setUint32(0, v); return this; }
  setSide(v: Side): this { this.setUint8(3, v); return this; }
}

class OrderDecoder extends MessageFlyweight {
  id(): number { return this.getUint32(0); }
  side(): Side { return this.getUint8(3) as Side; }
}

describe('roundtrip — enum field', () => {
  it('enum value roundtrips correctly', () => {
    const buf = new ArrayBuffer(OrderEncoder.BLOCK_LENGTH);
    new OrderEncoder(buf, 0).setId(0).setSide(Side.Sell);
    expect(new OrderDecoder(buf, 0).side()).toBe(Side.Sell);
  });
});

// --- Bitset field roundtrip ---

const Flags = {
  IsMarket: (1 << 0) >>> 0,
  IsBlock:  (1 << 3) >>> 0,
} as const;
type Flags = number;

function hasFlag(value: Flags, flag: number): boolean {
  return (value & flag) !== 0;
}

class FlagEncoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 1;
  setFlags(v: Flags): this { this.setUint8(0, v); return this; }
}

class FlagDecoder extends MessageFlyweight {
  flags(): Flags { return this.getUint8(0) as Flags; }
}

describe('roundtrip — bitset field', () => {
  it('bitset roundtrips and hasFlag works', () => {
    const buf = new ArrayBuffer(FlagEncoder.BLOCK_LENGTH);
    const encoded = (Flags.IsMarket | Flags.IsBlock) >>> 0;
    new FlagEncoder(buf, 0).setFlags(encoded);
    const decoded = new FlagDecoder(buf, 0).flags();
    expect(hasFlag(decoded, Flags.IsMarket)).toBe(true);
    expect(hasFlag(decoded, Flags.IsBlock)).toBe(true);
    expect(hasFlag(decoded, (1 << 1) >>> 0)).toBe(false);
  });
});
