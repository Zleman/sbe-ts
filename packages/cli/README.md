# sbe-ts-cli

Code generator for [Simple Binary Encoding](https://github.com/real-logic/simple-binary-encoding). Compiles an SBE XML schema into TypeScript decoder and encoder classes that extend the zero-allocation `sbe-ts` runtime.

## Install

```
npm install sbe-ts
npm install -D sbe-ts-cli
```

## Command

```
npx sbe-ts-cli generate --schema <path> --output <dir> [--package <name>]
```

| Flag | Required | Description |
|---|---|---|
| `--schema` | yes | Path to SBE XML schema file |
| `--output` | yes | Directory to write generated `.ts` files into |
| `--package` | no | Package name embedded in file headers |

## Input: SBE XML schema

A standard real-logic-compatible schema file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sbe:messageSchema
  xmlns:sbe="http://fixprotocol.io/2016/sbe"
  package="market.data"
  id="1"
  version="0"
  byteOrder="littleEndian">

  <types>
    <composite name="messageHeader">
      <type name="blockLength" primitiveType="uint16"/>
      <type name="templateId"  primitiveType="uint16"/>
      <type name="schemaId"    primitiveType="uint16"/>
      <type name="version"     primitiveType="uint16"/>
    </composite>
  </types>

  <sbe:message name="MarketData" id="1" blockLength="24">
    <field name="instrumentId" id="1" type="uint32" offset="0"/>
    <field name="price"        id="2" type="int64"  offset="4"/>
    <field name="quantity"     id="3" type="int64"  offset="12"/>
    <field name="flags"        id="4" type="uint32" offset="20"/>
  </sbe:message>

</sbe:messageSchema>
```

## Output: generated TypeScript

Running `generate` on the schema above produces two files.

### `MessageHeader.ts`

```typescript
// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.
import { CompositeFlyweight } from 'sbe-ts';

export class MessageHeaderDecoder extends CompositeFlyweight {
  static readonly SIZE = 8;

  blockLength(): number { return this.getUint16(0); }
  templateId():  number { return this.getUint16(2); }
  schemaId():    number { return this.getUint16(4); }
  version():     number { return this.getUint16(6); }
}

export class MessageHeaderEncoder extends CompositeFlyweight {
  setBlockLength(v: number): this { this.setUint16(0, v); return this; }
  setTemplateId(v:  number): this { this.setUint16(2, v); return this; }
  setSchemaId(v:    number): this { this.setUint16(4, v); return this; }
  setVersion(v:     number): this { this.setUint16(6, v); return this; }
}
```

### `MarketData.ts`

```typescript
// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.
// Package: market.data  Schema ID: 1  Version: 0
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

export class MarketDataEncoder extends MessageFlyweight {
  setInstrumentId(v: number): this { this.setUint32(0, v); return this; }
  setPrice(v:        bigint):  this { this.setInt64(4, v); return this; }
  setQuantity(v:     bigint):  this { this.setInt64(12, v); return this; }
  setFlags(v:        number):  this { this.setUint32(20, v); return this; }
}
```

## Composite types

Composites defined in `<types>` are generated as standalone files. If a message field references a composite by name, the decoder emits a pre-allocated accessor that wraps the buffer in-place — zero extra allocation per call:

```typescript
// Schema: <field name="header" id="1" type="messageHeader" offset="0"/>
// Generated in the message decoder:
header(): MessageHeaderDecoder {
  return this._header.wrap(this.getBuffer(), this.offset + 0);
}
```

The composite file (`MessageHeader.ts`) is written to the same output directory, and the message file imports it automatically.

## SBE primitive type reference

| SBE type | Bytes | TypeScript type | DataView method |
|---|---|---|---|
| `int8` | 1 | `number` | `getInt8` / `setInt8` |
| `uint8` | 1 | `number` | `getUint8` / `setUint8` |
| `int16` | 2 | `number` | `getInt16` / `setInt16` |
| `uint16` | 2 | `number` | `getUint16` / `setUint16` |
| `float16` | 2 | `number` | `getFloat16` / `setFloat16` |
| `int32` | 4 | `number` | `getInt32` / `setInt32` |
| `uint32` | 4 | `number` | `getUint32` / `setUint32` |
| `float` | 4 | `number` | `getFloat32` / `setFloat32` |
| `int64` | 8 | `bigint` | `getBigInt64` / `setBigInt64` |
| `uint64` | 8 | `bigint` | `getBigUint64` / `setBigUint64` |
| `double` | 8 | `number` | `getFloat64` / `setFloat64` |

All multi-byte reads respect the schema's `byteOrder`. For big-endian schemas, generated classes override the constructor to bake in `littleEndian = false`.

## Limitations

The following SBE features produce a `// skipped:` comment in the generated output rather than an accessor:

- **Array-typed fields** — `<type>` elements with `length > 1` (e.g. `char[6]` vehicle codes). The bytes are laid out correctly but no single accessor is emitted.
- **`<ref>` elements inside composites** — offsets are computed correctly for size calculations, but no typed accessor is generated.
- **`presence="constant"` fields** — occupy zero wire bytes and are excluded from both offset calculation and accessor generation.
- **Composite-within-composite codegen** — nested composites (e.g. a `<ref>` to another composite inside a composite) are not recursively expanded into accessor methods.

In all cases the generated file is valid TypeScript and the wire layout is correct — only those specific fields lack a typed accessor.

## Requirements

- Node 22+
- `sbe-ts` as a runtime dependency (peer)
