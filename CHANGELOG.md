# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-04-28

### Added

**Runtime (`sbe-ts`)**
- `MessageFlyweight` base class: wraps `ArrayBufferLike` + `DataView`, all 11 SBE primitive types
- `float16` support via native `DataView.getFloat16` / `setFloat16` (Node 22+ / V8 12.x)
- `Symbol.dispose` on `MessageFlyweight` for the `using` keyword (TypeScript 5.2+)
- `wrap(buffer, offset)` for zero-allocation flyweight reuse across messages
- `wrapOffset(offset)` fast-path for ring-buffer feeds where the buffer never changes
- `CompositeFlyweight` — type alias for `MessageFlyweight`; base for fixed-length nested composite types
- `GroupIterator<T>` — zero-allocation `for...of` iterator for SBE repeating groups; pre-allocated
  entry flyweight, `absoluteEnd()` fast-forward for early `break`, idempotent after completion
- `GroupWriter<T>` — write-side counterpart; `next()` positions the entry flyweight at the next
  write slot, `RangeError` on overflow, `absoluteEnd()` syncs pending entry
- `cursor` field on `MessageFlyweight` for sequential VarData / group-offset tracking
- `encodeString` / `decodeString` utilities for fixed-length ASCII fields
- Big-endian support via `littleEndian` constructor flag

**CLI (`sbe-ts-cli`)**
- `generate` command: compile SBE XML schema → TypeScript decoder/encoder classes
- Parser: SBE XML → internal IR via `fast-xml-parser` v5; handles `bigEndian`, missing
  `<types>` block, all 11 primitive types, real-logic corpus schemas
- Message codegen: generates `${Name}Decoder` / `${Name}Encoder` extending `MessageFlyweight`;
  both classes export `BLOCK_LENGTH`; endianness baked into constructor for non-default byte orders
- Composite codegen: generates `${Name}Decoder` / `${Name}Encoder` extending `CompositeFlyweight`
  with sequentially inferred field offsets and `SIZE` static constant
- Composite field accessors: message fields whose type resolves to a known composite emit
  a typed accessor (`field(): CompositeDecoder`) backed by a pre-allocated private instance — zero allocation per read
- Enum codegen: `<enum>` elements → `as const` objects + type aliases (tree-shakeable, no TS enum footguns)
- Bitset codegen: `<set>` elements → `as const` bitmask objects + `hasFlag()` helper
- VarData codegen: `<data>` elements → `Uint8Array` accessor / setter with length-prefix encoding;
  `wrap()` override resets cursor to `BLOCK_LENGTH`
- Group codegen: `<group>` elements → entry classes with `absoluteEnd()`, nested group support,
  `GroupIterator` on decoders and `GroupWriter` on encoders; first VarData after groups syncs
  from last iterator/writer's `absoluteEnd()`
- Encoder group accessors: `xyzCount(n)` writes the group header and returns a `GroupWriter<XyzEntry>`
- Schema validation: descriptive errors for missing `name` / `type` attributes, including
  message name, field index, and file path
- CLI entry via `util.parseArgs` (no commander dependency)

**Tooling**
- Dual-compiler setup: `tsgo` (`@typescript/native-preview`) for typecheck, `tsdown` for
  ESM/CJS build with proper `.mjs` / `.cjs` extensions
- Pre-test typecheck: `pretest` script runs `tsgo --noEmit` on both `src` and `test` before Vitest
- GitHub Actions CI: Node 24, tsgo typecheck, test, build

### Deferred
- Schema evolution / version checking
- WASM hot path
