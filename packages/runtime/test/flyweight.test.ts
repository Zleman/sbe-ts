import { describe, it, expect } from 'vitest';
import { MessageFlyweight } from '../src/flyweight.js';

class TestFlyweight extends MessageFlyweight {
  getView(): DataView { return this.view; }
  getCursor(): number { return this.cursor; }
  setCursor(n: number): void { this.cursor = n; }
}

describe('MessageFlyweight', () => {
  it('reads uint8 at correct offset', () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint8(2, 255);
    const msg = new MessageFlyweight(buf, 0);
    expect(msg.getUint8(2)).toBe(255);
  });

  it('reads int8 negative', () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt8(0, -42);
    const msg = new MessageFlyweight(buf, 0);
    expect(msg.getInt8(0)).toBe(-42);
  });

  it('reads uint32 little-endian', () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint32(4, 0xdeadbeef, true);
    const msg = new MessageFlyweight(buf, 0);
    expect(msg.getUint32(4)).toBe(0xdeadbeef);
  });

  it('reads uint32 big-endian', () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, 0x01020304, false);
    const msg = new MessageFlyweight(buf, 0, false);
    expect(msg.getUint32(0)).toBe(0x01020304);
  });

  it('reads int64 as bigint', () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigInt64(0, -9007199254740993n, true);
    const msg = new MessageFlyweight(buf, 0);
    expect(msg.getInt64(0)).toBe(-9007199254740993n);
  });

  it('reads uint64 as bigint', () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, 18446744073709551615n, true);
    const msg = new MessageFlyweight(buf, 0);
    expect(msg.getUint64(0)).toBe(18446744073709551615n);
  });

  it('reads float64', () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, Math.PI, true);
    const msg = new MessageFlyweight(buf, 0);
    expect(msg.getFloat64(0)).toBeCloseTo(Math.PI);
  });

  it('reads float32', () => {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, 1.5, true);
    const msg = new MessageFlyweight(buf, 0);
    expect(msg.getFloat32(0)).toBeCloseTo(1.5);
  });

  it('honours non-zero base offset', () => {
    const buf = new ArrayBuffer(16);
    new DataView(buf).setUint32(8, 42, true);
    const msg = new MessageFlyweight(buf, 4);
    expect(msg.getUint32(4)).toBe(42);
  });

  it('write roundtrips — setUint32 then getUint32', () => {
    const buf = new ArrayBuffer(8);
    const msg = new MessageFlyweight(buf, 0);
    msg.setUint32(0, 123456789);
    expect(msg.getUint32(0)).toBe(123456789);
  });

  it('write roundtrips — setInt64 then getInt64', () => {
    const buf = new ArrayBuffer(8);
    const msg = new MessageFlyweight(buf, 0);
    msg.setInt64(0, -1234567890123456789n);
    expect(msg.getInt64(0)).toBe(-1234567890123456789n);
  });

  it('setter returns this for chaining', () => {
    const buf = new ArrayBuffer(8);
    const msg = new MessageFlyweight(buf, 0);
    const result = msg.setUint32(0, 1).setUint32(4, 2);
    expect(result).toBe(msg);
    expect(msg.getUint32(0)).toBe(1);
    expect(msg.getUint32(4)).toBe(2);
  });

  it('wrap re-points to a new buffer', () => {
    const buf1 = new ArrayBuffer(4);
    const buf2 = new ArrayBuffer(4);
    new DataView(buf1).setUint32(0, 111, true);
    new DataView(buf2).setUint32(0, 222, true);
    const msg = new MessageFlyweight(buf1, 0);
    expect(msg.getUint32(0)).toBe(111);
    msg.wrap(buf2, 0);
    expect(msg.getUint32(0)).toBe(222);
  });

  it('wrap preserves DataView reference when same buffer is re-wrapped', () => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint32(0, 42, true);
    const msg = new TestFlyweight(buf, 0);
    const viewBefore = msg.getView();
    msg.wrap(buf, 4);
    expect(msg.getView()).toBe(viewBefore);
    expect(msg.getUint32(-4)).toBe(42);
  });

  it('cursor initialises to 0 on construction', () => {
    const buf = new ArrayBuffer(8);
    const msg = new TestFlyweight(buf, 0);
    expect(msg.getCursor()).toBe(0);
  });

  it('wrap resets cursor to 0', () => {
    const buf = new ArrayBuffer(16);
    const msg = new TestFlyweight(buf, 0);
    msg.setCursor(99);
    msg.wrap(buf, 4);
    expect(msg.getCursor()).toBe(0);
  });
});
