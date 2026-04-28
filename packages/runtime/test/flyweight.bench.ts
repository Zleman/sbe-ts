import { describe, bench } from 'vitest';
import { MessageFlyweight } from '../src/flyweight.js';

class PureNumberDecoder extends MessageFlyweight {
  private _u32!: Uint32Array;

  constructor(buf: ArrayBuffer, offset: number) {
    super(buf, offset);
    this._u32 = new Uint32Array(buf);
  }

  override wrap(buf: ArrayBuffer, offset: number): this {
    const prev = this.view.buffer;
    super.wrap(buf, offset);
    if (prev !== buf) this._u32 = new Uint32Array(buf);
    return this;
  }

  a(): number { return this._u32[(this.offset) >> 2]!; }
  b(): number { return this._u32[(this.offset + 4) >> 2]!; }
  c(): number { return this._u32[(this.offset + 8) >> 2]!; }
  d(): number { return this._u32[(this.offset + 12) >> 2]!; }
}

class MarketDataDecoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 24;
  instrumentId(): number { return this.getUint32(0); }
  price():        bigint  { return this.getInt64(4); }
  quantity():     bigint  { return this.getInt64(12); }
  flags():        number  { return this.getUint32(20); }
}

// 10 distinct buffers with varying field values — prevents V8 from constant-folding
// the offset arithmetic or speculating on a single buffer address.
const POOL_SIZE = 10;
const buffers = Array.from({ length: POOL_SIZE }, (_, i) => {
  const b = new ArrayBuffer(24);
  const v = new DataView(b);
  v.setUint32(0, i + 1, true);
  v.setBigInt64(4, BigInt(i * 1000 + 123456789), true);
  v.setBigInt64(12, BigInt(i * 1000 + 987654321), true);
  v.setUint32(20, i + 7, true);
  return b;
});

const jsonMessages = Array.from({ length: POOL_SIZE }, (_, i) =>
  JSON.stringify({
    instrumentId: i + 1,
    price: i * 1000 + 123456789,
    quantity: i * 1000 + 987654321,
    flags: i + 7,
  }),
);

const pureBuffers = Array.from({ length: POOL_SIZE }, (_, i) => {
  const b = new ArrayBuffer(16);
  const v = new DataView(b);
  v.setUint32(0,  i + 1,  true);
  v.setUint32(4,  i + 2,  true);
  v.setUint32(8,  i + 3,  true);
  v.setUint32(12, i + 4,  true);
  return b;
});

const decoder = new MarketDataDecoder(buffers[0]!, 0);
const pureDecoder = new PureNumberDecoder(pureBuffers[0]!, 0);
let idx = 0;
let _numSink = 0;
let _bigSink = 0n;

describe('MarketData decode', () => {
  bench('flyweight wrap (zero-alloc hot path)', () => {
    idx = (idx + 1) % POOL_SIZE;
    decoder.wrap(buffers[idx]!, 0);
    _numSink ^= decoder.instrumentId() | decoder.flags();
    _bigSink ^= decoder.price() ^ decoder.quantity();
  });

  bench('flyweight new (with constructor)', () => {
    idx = (idx + 1) % POOL_SIZE;
    const d = new MarketDataDecoder(buffers[idx]!, 0);
    _numSink ^= d.instrumentId() | d.flags();
    _bigSink ^= d.price() ^ d.quantity();
  });

  bench('JSON.parse', () => {
    idx = (idx + 1) % POOL_SIZE;
    const obj = JSON.parse(jsonMessages[idx]!) as {
      instrumentId: number;
      price: number;
      quantity: number;
      flags: number;
    };
    _numSink ^= obj.instrumentId | obj.flags;
    _bigSink ^= BigInt(obj.price) ^ BigInt(obj.quantity);
  });
});

// Ring buffer: all messages packed sequentially — same ArrayBuffer, different offsets.
// This is the realistic hot path for exchange feeds (ring buffer or flat array of messages).
// wrap() becomes a single offset integer assignment once the TypedArray is initialized.
const MSG_SIZE = 16;
const ringBuf = (() => {
  const buf = new ArrayBuffer(POOL_SIZE * MSG_SIZE);
  const v = new DataView(buf);
  for (let i = 0; i < POOL_SIZE; i++) {
    v.setUint32(i * MSG_SIZE,      i + 1, true);
    v.setUint32(i * MSG_SIZE + 4,  i + 2, true);
    v.setUint32(i * MSG_SIZE + 8,  i + 3, true);
    v.setUint32(i * MSG_SIZE + 12, i + 4, true);
  }
  return buf;
})();

describe('PureNumber decode (TypedArray fast path)', () => {
  bench('TypedArray separate buffers (rotating ArrayBuffer)', () => {
    idx = (idx + 1) % POOL_SIZE;
    pureDecoder.wrap(pureBuffers[idx]!, 0);
    _numSink ^= pureDecoder.a() ^ pureDecoder.b() ^ pureDecoder.c() ^ pureDecoder.d();
  });

  bench('TypedArray ring-buffer (same buffer, different offsets)', () => {
    idx = (idx + 1) % POOL_SIZE;
    pureDecoder.wrap(ringBuf, idx * MSG_SIZE);
    _numSink ^= pureDecoder.a() ^ pureDecoder.b() ^ pureDecoder.c() ^ pureDecoder.d();
  });

  bench('TypedArray new (with constructor)', () => {
    idx = (idx + 1) % POOL_SIZE;
    const d = new PureNumberDecoder(pureBuffers[idx]!, 0);
    _numSink ^= d.a() ^ d.b() ^ d.c() ^ d.d();
  });
});

// prevents V8 from eliminating sink writes as dead code
if (_numSink === 0x7fffffff && _bigSink === 0x7fffffffn) throw new Error('impossible');
