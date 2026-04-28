# sbe-ts

TypeScript implementation of [Simple Binary Encoding](https://github.com/real-logic/simple-binary-encoding) — the wire format used by financial exchanges for ultra-low-latency message streaming.

## Why SBE

Normal approach: receive bytes → `JSON.parse` → allocate an object → read fields.
SBE approach: receive bytes → place a stencil over the buffer → read fields at fixed byte offsets.

No object allocation per message for fixed primitive and composite fields. No string parsing. No GC pressure. The stencil is called a **flyweight** — it wraps the raw buffer and exposes typed accessors. The same flyweight instance is reused across every message in the stream. VarData accessors return a zero-copy `Uint8Array` view (one lightweight allocation per call, no data copied).

**Measured on Node 24** with rotating buffers (no V8 constant-fold): flyweight decode at **11.6M ops/sec** vs **3.5M ops/sec** for `JSON.parse` — **3.3× faster throughput** and **5.3× better p999 latency** (300 ns vs 1,600 ns). The gap widens with larger messages.

## Packages

| Package | Description | Docs |
|---|---|---|
| [`sbe-ts`](packages/runtime/) | Zero-allocation runtime — `MessageFlyweight`, `CompositeFlyweight`, string utilities | [README](packages/runtime/README.md) |
| [`sbe-ts-cli`](packages/cli/) | Code generator — compile SBE XML schemas to typed TypeScript decoder/encoder classes | [README](packages/cli/README.md) |

## Quick start

```
npm install sbe-ts
npm install -D sbe-ts-cli
```

Define your schema:

```xml
<sbe:message name="MarketData" id="1" blockLength="24">
  <field name="price"    id="1" type="int64"  offset="0"/>
  <field name="quantity" id="2" type="int64"  offset="8"/>
  <field name="flags"    id="3" type="uint32" offset="16"/>
</sbe:message>
```

Generate:

```
npx sbe-ts-cli generate --schema schema.xml --output src/generated
```

Use:

```typescript
import { MarketDataDecoder } from './src/generated/MarketData.js';

const decoder = new MarketDataDecoder(buffer, headerSize);

while (stream.hasNext()) {
  decoder.wrap(stream.nextBuffer(), stream.offset());
  console.log(decoder.price(), decoder.quantity());
}
```

`decoder.wrap()` re-points the flyweight at a new buffer with zero allocation.

## Requirements

- **`sbe-ts` runtime**: Node 22+ (for native `DataView.getFloat16`)
- **`sbe-ts-cli`**: Node 20+
- TypeScript 6+ recommended; TypeScript 5.2+ minimum

## Status

**v1.0.0** — production-ready for schemas using primitive fields, composite types, enums, bitsets, repeating groups, and variable-length data.

Deferred to v1.1:
- Schema evolution / version checking
- WASM hot path (DataView baseline benchmarked first)

## Reference

- [SBE specification](https://github.com/real-logic/simple-binary-encoding/wiki)
- [real-logic/simple-binary-encoding](https://github.com/real-logic/simple-binary-encoding) — reference implementation (Java, C++, C#, Go)
