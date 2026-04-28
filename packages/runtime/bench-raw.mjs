// Raw Node.js micro-benchmark — no framework overhead, ring-buffer pattern.
// Run: node bench-raw.mjs
// On Windows: switch to High Performance power plan first for stable clocks.

import { MessageFlyweight } from './dist/index.mjs';

// ── stat helpers ──────────────────────────────────────────────────────────────

function hz(iters, ms) {
  return ((iters / ms) * 1000).toLocaleString('en', { maximumFractionDigits: 0 });
}

// Run fn N times, return sorted array of ops/sec.
function sample(fn, runs, warmup, iters) {
  const results = [];
  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < warmup; i++) fn(i);
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) fn(i);
    results.push((iters / (performance.now() - t0)) * 1000);
  }
  results.sort((a, b) => a - b);
  return results;
}

function fmt(n) {
  return n.toLocaleString('en', { maximumFractionDigits: 0 }).padStart(12);
}

function bench(name, fn, {
  runs   = 5,
  warmup = 1_000_000,
  iters  = 10_000_000,
} = {}) {
  const s = sample(fn, runs, warmup, iters);
  const med = s[Math.floor(s.length / 2)];
  const min = s[0];
  const max = s[s.length - 1];
  const pct = ((max - min) / med * 100).toFixed(1);
  console.log(
    `${name.padEnd(54)}${fmt(med)}  [min ${fmt(min)}  max ${fmt(max)}  spread ${pct.padStart(5)}%]  ops/sec`,
  );
}

// ── flyweight-helper decoders (old style: this.getUint32) ─────────────────────

class FlyweightDecoder extends MessageFlyweight {
  a() { return this.getUint32(0); }
  b() { return this.getUint32(4); }
  c() { return this.getUint32(8); }
  d() { return this.getUint32(12); }
}

class FlyweightBigIntDecoder extends MessageFlyweight {
  instrumentId() { return this.getUint32(0); }
  price()        { return this.getInt64(4); }
  quantity()     { return this.getInt64(12); }
  flags()        { return this.getUint32(20); }
}

// ── direct DataView decoders (new style: this.view.getUint32(this.offset+N, true)) ─

class DirectDecoder extends MessageFlyweight {
  a() { return this.view.getUint32(this.offset + 0, true); }
  b() { return this.view.getUint32(this.offset + 4, true); }
  c() { return this.view.getUint32(this.offset + 8, true); }
  d() { return this.view.getUint32(this.offset + 12, true); }
}

class DirectBigIntDecoder extends MessageFlyweight {
  instrumentId() { return this.view.getUint32(this.offset + 0, true); }
  price()        { return this.view.getBigInt64(this.offset + 4, true); }
  quantity()     { return this.view.getBigInt64(this.offset + 12, true); }
  flags()        { return this.view.getUint32(this.offset + 20, true); }
}

// ── TypedArray decoder (for comparison) ──────────────────────────────────────

class TypedArrayDecoder extends MessageFlyweight {
  _u32;
  constructor(buf, offset) {
    super(buf, offset);
    this._u32 = new Uint32Array(buf);
  }
  wrap(buf, offset) {
    const prev = this.view.buffer;
    super.wrap(buf, offset);
    if (prev !== buf) this._u32 = new Uint32Array(buf);
    return this;
  }
  a() { return this._u32[(this.offset) >> 2]; }
  b() { return this._u32[(this.offset + 4) >> 2]; }
  c() { return this._u32[(this.offset + 8) >> 2]; }
  d() { return this._u32[(this.offset + 12) >> 2]; }
}

// ── buffers ───────────────────────────────────────────────────────────────────

const MSG_SIZE  = 24;
const POOL      = 10;
const RING_SIZE = POOL * MSG_SIZE;

const ringBuf = new ArrayBuffer(RING_SIZE);
const ringView = new DataView(ringBuf);
for (let i = 0; i < POOL; i++) {
  const base = i * MSG_SIZE;
  ringView.setUint32(base,      i + 1, true);
  ringView.setUint32(base + 4,  i + 2, true);
  ringView.setUint32(base + 8,  i + 3, true);
  ringView.setUint32(base + 12, i + 4, true);
  ringView.setBigInt64(base + 4,  BigInt(i * 1000 + 123456789), true);
  ringView.setBigInt64(base + 12, BigInt(i * 1000 + 987654321), true);
  ringView.setUint32(base + 20, i + 7, true);
}

const rotBufs = Array.from({ length: POOL }, (_, i) => {
  const b = new ArrayBuffer(MSG_SIZE);
  const v = new DataView(b);
  v.setUint32(0,  i + 1, true);
  v.setUint32(4,  i + 2, true);
  v.setUint32(8,  i + 3, true);
  v.setUint32(12, i + 4, true);
  return b;
});

const fwDec  = new FlyweightDecoder(ringBuf, 0);
const fwBi   = new FlyweightBigIntDecoder(ringBuf, 0);
const drDec  = new DirectDecoder(ringBuf, 0);
const drBi   = new DirectBigIntDecoder(ringBuf, 0);
const taDec  = new TypedArrayDecoder(ringBuf, 0);
const rotFw  = new FlyweightDecoder(rotBufs[0], 0);
const rotDr  = new DirectDecoder(rotBufs[0], 0);
let numSink = 0;
let bigSink = 0n;

console.log('\n=== Ring-buffer: flyweight helpers vs direct DataView calls ===\n');

bench('Flyweight  — ring — 4× uint32', (i) => {
  fwDec.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  numSink ^= fwDec.a() ^ fwDec.b() ^ fwDec.c() ^ fwDec.d();
});

bench('Direct     — ring — 4× uint32', (i) => {
  drDec.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  numSink ^= drDec.a() ^ drDec.b() ^ drDec.c() ^ drDec.d();
});

bench('TypedArray — ring — 4× uint32', (i) => {
  taDec.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  numSink ^= taDec.a() ^ taDec.b() ^ taDec.c() ^ taDec.d();
});

console.log('\n=== wrapOffset() vs wrap() on same buffer ===\n');

bench('wrap()       — ring — 4× uint32', (i) => {
  drDec.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  numSink ^= drDec.a() ^ drDec.b() ^ drDec.c() ^ drDec.d();
});

bench('wrapOffset() — ring — 4× uint32', (i) => {
  drDec.wrapOffset((i % POOL) * MSG_SIZE);
  numSink ^= drDec.a() ^ drDec.b() ^ drDec.c() ^ drDec.d();
});

console.log('\n=== BigInt path: flyweight vs direct ===\n');

bench('Flyweight — ring — 2× uint32 + 2× int64', (i) => {
  fwBi.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  numSink ^= fwBi.instrumentId() ^ fwBi.flags();
  bigSink ^= fwBi.price() ^ fwBi.quantity();
});

bench('Direct    — ring — 2× uint32 + 2× int64', (i) => {
  drBi.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  numSink ^= drBi.instrumentId() ^ drBi.flags();
  bigSink ^= drBi.price() ^ drBi.quantity();
});

console.log('\n=== Rotating buffers (different ArrayBuffer per message) ===\n');

bench('Flyweight  — rotating — 4× uint32', (i) => {
  rotFw.wrap(rotBufs[i % POOL], 0);
  numSink ^= rotFw.a() ^ rotFw.b() ^ rotFw.c() ^ rotFw.d();
});

bench('Direct     — rotating — 4× uint32', (i) => {
  rotDr.wrap(rotBufs[i % POOL], 0);
  numSink ^= rotDr.a() ^ rotDr.b() ^ rotDr.c() ^ rotDr.d();
});

console.log('\n=== Polymorphic vs monomorphic dispatch ===\n');

class Uint32PairDecoder extends MessageFlyweight {
  x() { return this.view.getUint32(this.offset + 0, true); }
  y() { return this.view.getUint32(this.offset + 4, true); }
}
class Uint16PairDecoder extends MessageFlyweight {
  p() { return this.view.getUint16(this.offset + 0, true); }
  q() { return this.view.getUint16(this.offset + 2, true); }
  r() { return this.view.getUint32(this.offset + 4, true); }
}
class Uint8Uint32Decoder extends MessageFlyweight {
  m() { return this.view.getUint8(this.offset + 0); }
  n() { return this.view.getUint32(this.offset + 4, true); }
}
class Uint32QuadDecoder extends MessageFlyweight {
  s() { return this.view.getUint32(this.offset + 0, true); }
  t() { return this.view.getUint32(this.offset + 4, true); }
  u() { return this.view.getUint32(this.offset + 8, true); }
  v() { return this.view.getUint32(this.offset + 12, true); }
}

const decA = new Uint32PairDecoder(ringBuf, 0);
const decB = new Uint16PairDecoder(ringBuf, 0);
const decC = new Uint8Uint32Decoder(ringBuf, 0);
const decD = new Uint32QuadDecoder(ringBuf, 0);
const decoders = [decA, decB, decC, decD];

bench('4 decoder types — round-robin (polymorphic)', (i) => {
  const dec = decoders[i & 3];
  dec.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  switch (i & 3) {
    case 0: numSink ^= dec.x() ^ dec.y(); break;
    case 1: numSink ^= dec.p() ^ dec.q() ^ dec.r(); break;
    case 2: numSink ^= dec.m() ^ dec.n(); break;
    default: numSink ^= dec.s() ^ dec.t() ^ dec.u() ^ dec.v();
  }
});

bench('1 decoder type — monomorphic (direct)', (i) => {
  drDec.wrap(ringBuf, (i % POOL) * MSG_SIZE);
  numSink ^= drDec.a() ^ drDec.b() ^ drDec.c() ^ drDec.d();
});

console.log('\n=== JSON.parse baseline ===\n');

const JSON_MSG = JSON.stringify({ a: 1, b: 2, c: 3, d: 4 });

bench('JSON.parse — 4 fields', (_i) => {
  const o = JSON.parse(JSON_MSG);
  numSink ^= o.a ^ o.b ^ o.c ^ o.d;
}, { warmup: 200_000, iters: 1_000_000 });

console.log();
if (numSink === 0x7fffffff && bigSink === 0x7fffffffn) throw new Error('impossible');
