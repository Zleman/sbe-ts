import { describe, it, expect } from 'vitest';
import { MessageFlyweight } from '../src/flyweight.js';
import { GroupIterator, GroupWriter } from '../src/group.js';
import type { GroupEntry } from '../src/group.js';

class FixedEntry extends MessageFlyweight implements GroupEntry {
  static readonly BLOCK_LENGTH = 4;
  a(): number { return this.getUint16(0); }
  b(): number { return this.getUint16(2); }
  absoluteEnd(): number { return this.offset + FixedEntry.BLOCK_LENGTH; }
}

class VarEntry extends MessageFlyweight implements GroupEntry {
  absoluteEnd(): number {
    return this.offset + 4 + this.getUint32(0);
  }
}

function makeFixedBuf(entries: [number, number][]): { buf: ArrayBuffer; byteLen: number } {
  const byteLen = entries.length * 4;
  const buf = new ArrayBuffer(byteLen);
  const dv = new DataView(buf);
  entries.forEach(([a, b], i) => {
    dv.setUint16(i * 4,     a, true);
    dv.setUint16(i * 4 + 2, b, true);
  });
  return { buf, byteLen };
}

function makeVarBuf(payloads: Uint8Array[]): { buf: ArrayBuffer; offsets: number[] } {
  const totalSize = payloads.reduce((s, p) => s + 4 + p.length, 0);
  const buf = new ArrayBuffer(totalSize);
  const dv = new DataView(buf);
  const offsets: number[] = [];
  let pos = 0;
  for (const p of payloads) {
    offsets.push(pos);
    dv.setUint32(pos, p.length, true);
    new Uint8Array(buf, pos + 4, p.length).set(p);
    pos += 4 + p.length;
  }
  return { buf, offsets };
}

describe('GroupIterator — fixed-stride entries', () => {
  it('yields all entries in order', () => {
    const { buf } = makeFixedBuf([[10, 20], [30, 40], [50, 60]]);
    const entry = new FixedEntry(buf, 0);
    const iter = new GroupIterator(entry);
    iter.reset(buf, 0, 3);

    const results: [number, number][] = [];
    for (const e of iter) {
      results.push([e.a(), e.b()]);
    }
    expect(results).toEqual([[10, 20], [30, 40], [50, 60]]);
  });

  it('absoluteEnd() after full iteration returns correct byte position', () => {
    const { buf, byteLen } = makeFixedBuf([[1, 2], [3, 4]]);
    const entry = new FixedEntry(buf, 0);
    const iter = new GroupIterator(entry);
    iter.reset(buf, 0, 2);
    for (const _ of iter) { /* consume all */ }
    expect(iter.absoluteEnd()).toBe(byteLen);
  });

  it('absoluteEnd() is idempotent after completion', () => {
    const { buf, byteLen } = makeFixedBuf([[1, 2], [3, 4]]);
    const entry = new FixedEntry(buf, 0);
    const iter = new GroupIterator(entry);
    iter.reset(buf, 0, 2);
    for (const _ of iter) { /* consume all */ }
    expect(iter.absoluteEnd()).toBe(byteLen);
    expect(iter.absoluteEnd()).toBe(byteLen);
  });

  it('return() fast-forwards remaining entries after break', () => {
    const { buf, byteLen } = makeFixedBuf([[10, 20], [30, 40], [50, 60]]);
    const entry = new FixedEntry(buf, 0);
    const iter = new GroupIterator(entry);
    iter.reset(buf, 0, 3);

    let count = 0;
    for (const _ of iter) {
      count++;
      break;
    }
    expect(count).toBe(1);
    expect(iter.absoluteEnd()).toBe(byteLen);
  });

  it('yields zero entries when numInGroup is 0', () => {
    const buf = new ArrayBuffer(0);
    const entry = new FixedEntry(new ArrayBuffer(0), 0);
    const iter = new GroupIterator(entry);
    iter.reset(buf, 0, 0);
    const results: unknown[] = [];
    for (const e of iter) results.push(e);
    expect(results).toHaveLength(0);
    expect(iter.absoluteEnd()).toBe(0);
  });
});

describe('GroupIterator — variable-length entries', () => {
  it('yields both entries with correct data', () => {
    const p0 = new Uint8Array([0x0A, 0x0B, 0x0C]);
    const p1 = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const { buf } = makeVarBuf([p0, p1]);
    const entry = new VarEntry(buf, 0);
    const iter = new GroupIterator(entry);
    iter.reset(buf, 0, 2);

    const results: number[][] = [];
    for (const e of iter) {
      results.push([...new Uint8Array(e.view.buffer, e.offset + 4, e.getUint32(0))]);
    }
    expect(results[0]).toEqual([0x0A, 0x0B, 0x0C]);
    expect(results[1]).toEqual([0x01, 0x02, 0x03, 0x04, 0x05]);
  });

  it('absoluteEnd() lands at the correct byte after variable entries', () => {
    const p0 = new Uint8Array([0x0A, 0x0B, 0x0C]);        // 7 bytes total
    const p1 = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]); // 9 bytes total
    const { buf } = makeVarBuf([p0, p1]);
    const entry = new VarEntry(buf, 0);
    const iter = new GroupIterator(entry);
    iter.reset(buf, 0, 2);
    for (const _ of iter) { /* consume all */ }
    expect(iter.absoluteEnd()).toBe(4 + 3 + 4 + 5);
  });
});

describe('GroupIterator — re-entrancy', () => {
  it('reset() allows reuse with a different buffer and count', () => {
    const buf1 = makeFixedBuf([[1, 2]]).buf;
    const buf2 = makeFixedBuf([[9, 8], [7, 6]]).buf;
    const entry = new FixedEntry(buf1, 0);
    const iter = new GroupIterator(entry);

    iter.reset(buf1, 0, 1);
    for (const _ of iter) { /* consume */ }
    expect(iter.absoluteEnd()).toBe(4);

    iter.reset(buf2, 0, 2);
    const vals: number[] = [];
    for (const e of iter) vals.push(e.a());
    expect(vals).toEqual([9, 7]);
    expect(iter.absoluteEnd()).toBe(8);
  });
});

class WritableEntry extends MessageFlyweight implements GroupEntry {
  static readonly BLOCK_LENGTH = 4;
  setA(v: number): this { this.setUint16(0, v); return this; }
  setB(v: number): this { this.setUint16(2, v); return this; }
  a(): number { return this.getUint16(0); }
  b(): number { return this.getUint16(2); }
  absoluteEnd(): number { return this.offset + WritableEntry.BLOCK_LENGTH; }
}

describe('GroupWriter — fixed-stride entries', () => {
  it('next() returns the entry flyweight positioned at each slot', () => {
    const buf = new ArrayBuffer(12);
    const entry = new WritableEntry(buf, 0);
    const writer = new GroupWriter(entry);
    writer.reset(buf, 0, 3);

    writer.next().setA(10).setB(20);
    writer.next().setA(30).setB(40);
    writer.next().setA(50).setB(60);

    const dv = new DataView(buf);
    expect(dv.getUint16(0, true)).toBe(10);
    expect(dv.getUint16(2, true)).toBe(20);
    expect(dv.getUint16(4, true)).toBe(30);
    expect(dv.getUint16(6, true)).toBe(40);
    expect(dv.getUint16(8, true)).toBe(50);
    expect(dv.getUint16(10, true)).toBe(60);
  });

  it('absoluteEnd() returns byte position after all written entries', () => {
    const buf = new ArrayBuffer(8);
    const entry = new WritableEntry(buf, 0);
    const writer = new GroupWriter(entry);
    writer.reset(buf, 0, 2);
    writer.next().setA(1).setB(2);
    writer.next().setA(3).setB(4);
    expect(writer.absoluteEnd()).toBe(8);
  });

  it('absoluteEnd() is idempotent after all entries written', () => {
    const buf = new ArrayBuffer(4);
    const entry = new WritableEntry(buf, 0);
    const writer = new GroupWriter(entry);
    writer.reset(buf, 0, 1);
    writer.next().setA(7).setB(8);
    expect(writer.absoluteEnd()).toBe(4);
    expect(writer.absoluteEnd()).toBe(4);
  });

  it('absoluteEnd() with zero entries returns the start position', () => {
    const buf = new ArrayBuffer(0);
    const entry = new WritableEntry(buf, 0);
    const writer = new GroupWriter(entry);
    writer.reset(buf, 0, 0);
    expect(writer.absoluteEnd()).toBe(0);
  });

  it('next() throws RangeError when all declared entries have been written', () => {
    const buf = new ArrayBuffer(4);
    const entry = new WritableEntry(buf, 0);
    const writer = new GroupWriter(entry);
    writer.reset(buf, 0, 1);
    writer.next().setA(1).setB(2);
    expect(() => writer.next()).toThrow(RangeError);
  });

  it('reset() allows reuse across different buffers', () => {
    const buf1 = new ArrayBuffer(4);
    const buf2 = new ArrayBuffer(8);
    const entry = new WritableEntry(buf1, 0);
    const writer = new GroupWriter(entry);

    writer.reset(buf1, 0, 1);
    writer.next().setA(11).setB(22);
    expect(writer.absoluteEnd()).toBe(4);

    writer.reset(buf2, 0, 2);
    writer.next().setA(33).setB(44);
    writer.next().setA(55).setB(66);
    expect(writer.absoluteEnd()).toBe(8);

    const dv = new DataView(buf2);
    expect(dv.getUint16(0, true)).toBe(33);
    expect(dv.getUint16(4, true)).toBe(55);
  });

  it('written data is readable back via GroupIterator over the same buffer', () => {
    const buf = new ArrayBuffer(12);
    const writeEntry = new WritableEntry(buf, 0);
    const writer = new GroupWriter(writeEntry);
    writer.reset(buf, 0, 3);
    writer.next().setA(1).setB(2);
    writer.next().setA(3).setB(4);
    writer.next().setA(5).setB(6);

    const readEntry = new FixedEntry(buf, 0);
    const iter = new GroupIterator(readEntry);
    iter.reset(buf, 0, 3);
    const results: [number, number][] = [];
    for (const e of iter) results.push([e.a(), e.b()]);
    expect(results).toEqual([[1, 2], [3, 4], [5, 6]]);
  });
});
