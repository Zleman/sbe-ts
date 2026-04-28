# sbe-ts

[![npm](https://img.shields.io/npm/v/sbe-ts)](https://www.npmjs.com/package/sbe-ts)

Zero-allocation [Simple Binary Encoding](https://github.com/real-logic/simple-binary-encoding) runtime for TypeScript. Reads SBE-encoded binary messages directly from an `ArrayBuffer` using a flyweight pattern. Fixed primitive fields and composite accessors are fully zero-allocation; VarData accessors return a zero-copy `Uint8Array` view (one lightweight view-object allocation per call, no data copied).

## Install

```
npm install sbe-ts
```

## What it does

Wraps a binary buffer with a typed stencil. Reading a field is a single `DataView` call at a fixed byte offset. The decoder object is reused across messages with `wrap()`.

Supports the full SBE feature set: fixed primitive fields, composite types, enums, bitsets, repeating groups (including nested groups), and variable-length data fields. `GroupIterator<T>` provides zero-allocation `for...of` iteration over repeating groups.

What it **doesn't** do: parse XML schemas, generate code, or handle network transport. For code generation from an SBE XML schema, see [`sbe-ts-cli`](../cli/README.md).

## Core usage

```typescript
import { MessageFlyweight } from 'sbe-ts';

const decoder = new MessageFlyweight(buffer, 0);

decoder.getUint32(0);   // read 4 bytes at field offset 0
decoder.getInt64(4);    // read 8 bytes at field offset 4 — returns bigint
decoder.getFloat64(12); // read 8 bytes at field offset 12
```

Reuse the same decoder for every message in the stream, zero allocation after the first `new`:

```typescript
while (hasMessages()) {
  decoder.wrap(nextBuffer(), headerSize);
  process(decoder.getUint32(0), decoder.getInt64(4));
}
```

## Performance guide

The library can reach ~210M ops/sec on a ring-buffer feed. Whether you hit that number or 21M depends entirely on three architectural choices in your ingest pipeline.

### 1. Use a ring buffer and `wrapOffset()` — don't allocate per message

```typescript
// Allocate once at startup
const ringBuffer = new ArrayBuffer(64 * 1024); // 64 KB ring
decoder.wrap(ringBuffer, 0);                   // initial wrap sets the DataView

// Hot loop — wrapOffset() updates only the integer offset, zero allocation
while (feed.hasMessages()) {
  const offset = feed.writeNext(ringBuffer);
  decoder.wrapOffset(offset);  // ~210M ops/sec
  process(decoder);
}
```

`wrapOffset()` skips the buffer-identity check and DataView construction entirely — it's a single integer assignment. Use it whenever the underlying buffer doesn't change between messages, which is always true on a ring.

If you can't use a ring (e.g. incoming network packets land in separate buffers), `wrap()` still handles it but constructs a new `DataView` per call, landing around 21M ops/sec. That's still 3.4× faster than `JSON.parse`, but not the 210M ceiling. Pre-allocate one large buffer and copy incoming frames into it to recover the full ring-buffer throughput.

### 2. Pre-allocate decoders — one instance per message type

```typescript
// At startup — allocate once, reuse forever
const marketData = new MarketDataDecoder(RING_BUF, 0);
const orderAck   = new OrderAckDecoder(RING_BUF, 0);

// Per message — wrap() only updates the offset integer
marketData.wrap(ringBuffer, offset);
```

Creating `new MarketDataDecoder()` inside a hot loop re-allocates the object and forces V8 to re-derive the hidden class. One instance per type, allocated once.

### 3. Keep handler functions monomorphic — branch at the dispatch layer

V8 compiles a dedicated machine-code stub for a function that always sees the same object shape. If one function handles multiple decoder types, the stub degenerates to a polymorphic lookup and throughput can drop 3×.

The fix is to keep each handler function dedicated to one decoder type, and do the routing in a thin jump table:

```typescript
const mktDecoder = new MarketDataDecoder(ringBuf, 0);
const ackDecoder = new OrderAckDecoder(ringBuf, 0);

// Each function is monomorphic — V8 inlines all field accessors
function onMarketData(buf: ArrayBuffer, off: number): void {
  mktDecoder.wrap(buf, off);
  // ... read fields
}
function onOrderAck(buf: ArrayBuffer, off: number): void {
  ackDecoder.wrap(buf, off);
  // ... read fields
}

// O(1) dispatch — the table lookup is thin; work stays in the monomorphic handlers
const handlers = new Array<((buf: ArrayBuffer, off: number) => void) | undefined>(256);
handlers[MarketDataDecoder.TEMPLATE_ID] = onMarketData;
handlers[OrderAckDecoder.TEMPLATE_ID]   = onOrderAck;

while (feed.hasMessages()) {
  const { buf, off } = feed.next();
  const templateId = header.wrap(buf, off).templateId();
  handlers[templateId]?.(buf, off);
}
```

The dispatch table itself sees multiple function shapes (that's unavoidable). But it does no work except jump. The field accessors, where 99% of the CPU time is spent, are in the monomorphic handler functions and stay fast.

---

## Building your own decoder

Extend `MessageFlyweight` with named accessors. That's exactly what `sbe-ts-cli generate` produces:

```typescript
import { MessageFlyweight } from 'sbe-ts';

export class MarketDataDecoder extends MessageFlyweight {
  static readonly BLOCK_LENGTH = 24;
  static readonly TEMPLATE_ID  = 1;
  static readonly SCHEMA_ID    = 1;
  static readonly VERSION      = 0;

  instrumentId(): number { return this.getUint32(0); }
  price():        bigint  { return this.getInt64(4); }
  quantity():     bigint  { return this.getInt64(12); }
  flags():        number  { return this.getUint32(20); }
}

const decoder = new MarketDataDecoder(buffer, headerSize);
decoder.price(); // direct DataView read at byte 4, no allocation
```

## Composite types

`CompositeFlyweight` is the base for fixed-length nested structs (e.g., `messageHeader`). It has the same API as `MessageFlyweight`. `sbe-ts-cli` generates composite classes that extend it.

```typescript
import { CompositeFlyweight } from 'sbe-ts';

export class MessageHeaderDecoder extends CompositeFlyweight {
  static readonly SIZE = 8;
  blockLength(): number { return this.getUint16(0); }
  templateId():  number { return this.getUint16(2); }
  schemaId():    number { return this.getUint16(4); }
  version():     number { return this.getUint16(6); }
}
```

## `using` keyword

`MessageFlyweight` implements `Symbol.dispose`, so you can use it with TypeScript's `using` declaration. When the block exits, `offset` is set to `-1` as a use-after-dispose sentinel:

```typescript
{
  using decoder = new MarketDataDecoder(buffer, 0);
  decoder.price(); // fine
} // decoder[Symbol.dispose]() called — offset set to -1
```

Requires `"lib": ["ES2025", "ESNext.Disposable"]` in tsconfig and TypeScript 5.2+.

## Benchmark

Measured with a raw Node.js script (no framework overhead) on Node 24, Windows 11. Run `node bench-raw.mjs` in the runtime package to reproduce.

**Ring-buffer pattern**: one large `ArrayBuffer`, messages at different offsets. This is the realistic hot path for market data feeds.

| Scenario | ops/sec | vs JSON.parse |
|---|---|---|
| `wrapOffset()` — ring — 4× uint32 | **~210M** | **~34×** |
| `wrap()` — ring — 4× uint32 | **~165M** | **~26×** |
| `wrap()` — ring — 2× uint32 + 2× int64/BigInt | **~35M** | **~5×** |
| TypedArray — ring — 4× uint32 | ~140M | ~22× |
| `JSON.parse` — 4 fields | ~6.4M | baseline |

The BigInt rows are slower because `getBigInt64` crosses the JS number/BigInt boundary. Keep int64 fields off the hot path where possible.

**Rotating buffers**: one `ArrayBuffer` per logical message (typical network packet scenario). Each `wrap()` constructs a new `DataView` over the incoming buffer.

| Scenario | ops/sec | vs JSON.parse |
|---|---|---|
| sbe-ts — rotating — 4× uint32 | **~21M** | **~3.4×** |
| `JSON.parse` — 4 fields | ~6.4M | baseline |

Note: V8 inlines `DataView.getUint32(constantOffset)` to a near-direct memory read in the ring-buffer case. TypedArray still benefits non-V8 runtimes and older V8 builds.

## API reference

All methods are inherited by generated decoder/encoder subclasses.

### Constructor

```typescript
new MessageFlyweight(buffer: ArrayBufferLike, offset: number, littleEndian?: boolean)
// littleEndian defaults to true (SBE default)
```

### Buffer management

```typescript
wrap(buffer: ArrayBufferLike, offset: number): this  // re-point to a new buffer/offset; resets cursor
wrapOffset(offset: number): this                     // fast-path: update offset only, skip identity check
getBuffer(): ArrayBufferLike
getOffset(): number
[Symbol.dispose](): void                             // sets offset to -1
```

### Primitive reads (all take fieldOffset: number)

| Method | Returns | Bytes |
|---|---|---|
| `getInt8(o)` / `getUint8(o)` | `number` | 1 |
| `getInt16(o)` / `getUint16(o)` | `number` | 2 |
| `getFloat16(o)` | `number` | 2 |
| `getInt32(o)` / `getUint32(o)` | `number` | 4 |
| `getFloat32(o)` | `number` | 4 |
| `getInt64(o)` / `getUint64(o)` | `bigint` | 8 |
| `getFloat64(o)` | `number` | 8 |

### Primitive writes (fieldOffset, value — all return `this` for chaining)

Same naming with `set` prefix. `setInt64` / `setUint64` take `bigint`.

### String utilities

```typescript
import { encodeString, decodeString } from 'sbe-ts';

encodeString(str: string, buf: ArrayBufferLike, offset: number, maxLen: number): void
decodeString(buf: ArrayBufferLike, offset: number, maxLen: number): string
// stops at null byte; pads with zeros on encode
```

### GroupIterator

`GroupIterator<T>` iterates repeating groups with zero allocation per entry. Generated by `sbe-ts-cli`, not typically constructed directly.

```typescript
import { GroupIterator } from 'sbe-ts';
import type { GroupEntry } from 'sbe-ts';

// Generated entry class satisfies GroupEntry:
// interface GroupEntry {
//   wrap(buffer: ArrayBufferLike, offset: number): unknown;
//   absoluteEnd(): number;
// }

const fills = decoder.fills(); // returns GroupIterator<FillsEntry>
for (const entry of fills) {
  console.log(entry.price(), entry.quantity());
  // early break is safe — iterator.return() fast-forwards remaining entries
}
// fills.absoluteEnd() gives the byte position after all entries
```

## Requirements

- **Node 22+**: required for `DataView.getFloat16` / `setFloat16` (V8 native, no polyfill)
- TypeScript 5.2+ for `using` / `Symbol.dispose`; TypeScript 6+ recommended
