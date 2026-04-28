import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseSchema } from '../src/parser/schema.js';

const fixtures = join(fileURLToPath(import.meta.url), '..', 'fixtures');
const fix = (name: string) => join(fixtures, name);

function withTempSchema(xml: string, fn: (path: string) => void): void {
  const tmp = join(tmpdir(), `sbe-test-${Date.now()}.xml`);
  writeFileSync(tmp, xml);
  try {
    fn(tmp);
  } finally {
    unlinkSync(tmp);
  }
}

describe('parseSchema — metadata', () => {
  it('parses package, id, version, byteOrder from market-data.xml', () => {
    const schema = parseSchema(fix('market-data.xml'));
    expect(schema.package).toBe('market.data');
    expect(schema.id).toBe(1);
    expect(schema.version).toBe(0);
    expect(schema.byteOrder).toBe('littleEndian');
  });
});

describe('parseSchema — message structure', () => {
  it('returns exactly 2 messages with correct names', () => {
    const { messages } = parseSchema(fix('market-data.xml'));
    expect(messages).toHaveLength(2);
    expect(messages[0]!.name).toBe('MarketData');
    expect(messages[1]!.name).toBe('OrderAck');
  });

  it('MarketData has correct id, blockLength, and field count', () => {
    const md = parseSchema(fix('market-data.xml')).messages[0]!;
    expect(md.id).toBe(1);
    expect(md.blockLength).toBe(24);
    expect(md.fields).toHaveLength(4);
  });

  it('MarketData fields match XML exactly', () => {
    const fields = parseSchema(fix('market-data.xml')).messages[0]!.fields;
    expect(fields[0]).toEqual({ name: 'instrumentId', id: 1, type: 'uint32', offset: 0 });
    expect(fields[1]).toEqual({ name: 'price',        id: 2, type: 'int64',  offset: 4 });
    expect(fields[2]).toEqual({ name: 'quantity',     id: 3, type: 'int64',  offset: 12 });
    expect(fields[3]).toEqual({ name: 'flags',        id: 4, type: 'uint32', offset: 20 });
  });

  it('OrderAck has correct field types including uint8 and int16', () => {
    const fields = parseSchema(fix('market-data.xml')).messages[1]!.fields;
    expect(fields).toHaveLength(4);
    expect(fields[0]).toMatchObject({ name: 'orderId',    type: 'uint64', offset: 0 });
    expect(fields[1]).toMatchObject({ name: 'status',     type: 'uint8',  offset: 8 });
    expect(fields[2]).toMatchObject({ name: 'rejectCode', type: 'int16',  offset: 9 });
    expect(fields[3]).toMatchObject({ name: 'reserved',   type: 'uint32', offset: 12 });
  });
});

describe('parseSchema — composites', () => {
  it('returns 1 composite named messageHeader with 4 uint16 fields', () => {
    const { composites } = parseSchema(fix('market-data.xml'));
    expect(composites).toHaveLength(1);
    const header = composites[0]!;
    expect(header.name).toBe('messageHeader');
    expect(header.fields).toHaveLength(4);
    for (const f of header.fields) {
      expect(f.primitiveType).toBe('uint16');
    }
    expect(header.fields.map((f) => f.name)).toEqual([
      'blockLength', 'templateId', 'schemaId', 'version',
    ]);
  });
});

describe('parseSchema — byte order', () => {
  it('parses byteOrder as bigEndian from big-endian.xml', () => {
    const { byteOrder } = parseSchema(fix('big-endian.xml'));
    expect(byteOrder).toBe('bigEndian');
  });
});

describe('parseSchema — no types block', () => {
  it('returns empty composites array and does not throw', () => {
    const { composites } = parseSchema(fix('no-composites.xml'));
    expect(composites).toEqual([]);
  });
});

describe('parseSchema — all primitive types', () => {
  it('parses all 11 SBE primitive types without error', () => {
    const { messages } = parseSchema(fix('all-types.xml'));
    expect(messages).toHaveLength(1);
    const fields = messages[0]!.fields;
    expect(fields).toHaveLength(11);
    const types = fields.map((f) => f.type);
    expect(types).toContain('int8');
    expect(types).toContain('uint8');
    expect(types).toContain('int16');
    expect(types).toContain('uint16');
    expect(types).toContain('int32');
    expect(types).toContain('uint32');
    expect(types).toContain('int64');
    expect(types).toContain('uint64');
    expect(types).toContain('float');
    expect(types).toContain('double');
    expect(types).toContain('float16');
  });

  it('float16 field parses with correct name and offset', () => {
    const fields = parseSchema(fix('all-types.xml')).messages[0]!.fields;
    const f16 = fields.find((f) => f.type === 'float16')!;
    expect(f16.name).toBe('f_float16');
    expect(f16.offset).toBe(42);
  });
});

describe('parseSchema — error handling', () => {
  it('throws with file path in message when root element is missing', () => {
    withTempSchema('<?xml version="1.0"?><root><notSbe/></root>', (tmp) => {
      expect(() => parseSchema(tmp)).toThrow(tmp);
    });
  });
});

describe('parseSchema — real-logic corpus', () => {
  it('parses real-logic example-schema.xml without throwing', () => {
    const schema = parseSchema(fix('real-logic-example.xml'));
    expect(schema.messages.length).toBeGreaterThan(0);
    expect(['littleEndian', 'bigEndian']).toContain(schema.byteOrder);
  });
});

describe('parseSchema — multiple <types> blocks', () => {
  it('real-logic-example.xml has BooleanType and Model enums', () => {
    const { enums } = parseSchema(fix('real-logic-example.xml'));
    const names = enums.map((e) => e.name);
    expect(names).toContain('BooleanType');
    expect(names).toContain('Model');
  });

  it('real-logic-example.xml has OptionalExtras set', () => {
    const { sets } = parseSchema(fix('real-logic-example.xml'));
    expect(sets.map((s) => s.name)).toContain('OptionalExtras');
  });

  it('real-logic-example.xml has messageHeader and groupSizeEncoding composites', () => {
    const { composites } = parseSchema(fix('real-logic-example.xml'));
    const names = composites.map((c) => c.name);
    expect(names).toContain('messageHeader');
    expect(names).toContain('groupSizeEncoding');
  });

  it('Model enum values are char codes (A=65, B=66, C=67)', () => {
    const { enums } = parseSchema(fix('real-logic-example.xml'));
    const model = enums.find((e) => e.name === 'Model')!;
    expect(model.values).toContainEqual({ name: 'A', value: 65 });
    expect(model.values).toContainEqual({ name: 'B', value: 66 });
    expect(model.values).toContainEqual({ name: 'C', value: 67 });
  });

  it('Car message blockLength is a finite positive number', () => {
    const { messages } = parseSchema(fix('real-logic-example.xml'));
    const car = messages.find((m) => m.name === 'Car')!;
    expect(Number.isFinite(car.blockLength)).toBe(true);
    expect(car.blockLength).toBeGreaterThan(0);
  });

  it('Car modelYear field resolves to uint16 (scalar type alias)', () => {
    const { messages } = parseSchema(fix('real-logic-example.xml'));
    const car = messages.find((m) => m.name === 'Car')!;
    const field = car.fields.find((f) => f.name === 'modelYear')!;
    expect(field.type).toBe('uint16');
  });
});

describe('parseSchema — dimensionType resolution', () => {
  it('fuelFigures group has standard numInGroupOffset=2, numInGroupPrimitive=uint16, headerSize=4', () => {
    const { messages } = parseSchema(fix('real-logic-example.xml'));
    const car = messages.find((m) => m.name === 'Car')!;
    const group = car.groups.find((g) => g.name === 'fuelFigures')!;
    expect(group.numInGroupOffset).toBe(2);
    expect(group.numInGroupPrimitive).toBe('uint16');
    expect(group.headerSize).toBe(4);
  });
});

describe('parseSchema — varData', () => {
  it('parses 2 varData fields from var-data.xml', () => {
    const { messages } = parseSchema(fix('var-data.xml'));
    expect(messages[0]!.varData).toHaveLength(2);
  });

  it('first varData has correct name, id, type, lengthPrimitiveType, lengthByteSize', () => {
    const vd = parseSchema(fix('var-data.xml')).messages[0]!.varData[0]!;
    expect(vd.name).toBe('text');
    expect(vd.id).toBe(2);
    expect(vd.type).toBe('varStringEncoding');
    expect(vd.lengthPrimitiveType).toBe('uint32');
    expect(vd.lengthByteSize).toBe(4);
  });

  it('messages without data elements have empty varData array', () => {
    const { messages } = parseSchema(fix('market-data.xml'));
    for (const msg of messages) {
      expect(msg.varData).toEqual([]);
    }
  });

  it('real-logic Car message has 3 outer varData fields', () => {
    const { messages } = parseSchema(fix('real-logic-example.xml'));
    const car = messages[0]!;
    expect(car.varData.length).toBe(3);
    expect(car.varData.map((v) => v.name)).toEqual(['manufacturer', 'model', 'activationCode']);
  });
});

describe('parseSchema — enums', () => {
  it('returns 2 enums from enum-field.xml', () => {
    const { enums } = parseSchema(fix('enum-field.xml'));
    expect(enums).toHaveLength(2);
  });

  it('side enum has correct name, encodingType, and values', () => {
    const { enums } = parseSchema(fix('enum-field.xml'));
    const side = enums.find((e) => e.name === 'side')!;
    expect(side.encodingType).toBe('uint8');
    expect(side.values).toEqual([
      { name: 'Buy', value: 0 },
      { name: 'Sell', value: 1 },
    ]);
  });

  it('timeInForce enum preserves non-contiguous values', () => {
    const { enums } = parseSchema(fix('enum-field.xml'));
    const tif = enums.find((e) => e.name === 'timeInForce')!;
    expect(tif.values).toHaveLength(3);
    expect(tif.values.find((v) => v.name === 'ImmediateOrCancel')!.value).toBe(3);
  });

  it('schema with no enums returns empty enums array', () => {
    const { enums } = parseSchema(fix('market-data.xml'));
    expect(enums).toEqual([]);
  });
});

describe('parseSchema — sets', () => {
  it('returns 1 set from set-field.xml', () => {
    const { sets } = parseSchema(fix('set-field.xml'));
    expect(sets).toHaveLength(1);
    expect(sets[0]!.name).toBe('orderFlags');
    expect(sets[0]!.encodingType).toBe('uint8');
  });

  it('orderFlags set has correct choices with bit indices', () => {
    const { sets } = parseSchema(fix('set-field.xml'));
    const s = sets[0]!;
    expect(s.choices).toEqual([
      { name: 'IsMarket', bitIndex: 0 },
      { name: 'IsCross',  bitIndex: 1 },
      { name: 'IsBlock',  bitIndex: 3 },
    ]);
  });

  it('schema with no sets returns empty sets array', () => {
    const { sets } = parseSchema(fix('market-data.xml'));
    expect(sets).toEqual([]);
  });
});

describe('parseSchema — groups', () => {
  it('Trade message has 1 top-level group', () => {
    const { messages } = parseSchema(fix('groups.xml'));
    expect(messages[0]!.groups).toHaveLength(1);
  });

  it('fills group has correct name, blockLength, and 2 fields', () => {
    const fills = parseSchema(fix('groups.xml')).messages[0]!.groups[0]!;
    expect(fills.name).toBe('fills');
    expect(fills.blockLength).toBe(6);
    expect(fills.fields).toHaveLength(2);
    expect(fills.fields[0]).toMatchObject({ name: 'price', type: 'uint32', offset: 0 });
    expect(fills.fields[1]).toMatchObject({ name: 'quantity', type: 'uint16', offset: 4 });
  });

  it('fills group has 1 nested group named legs with blockLength 4', () => {
    const fills = parseSchema(fix('groups.xml')).messages[0]!.groups[0]!;
    expect(fills.groups).toHaveLength(1);
    const legs = fills.groups[0]!;
    expect(legs.name).toBe('legs');
    expect(legs.blockLength).toBe(4);
    expect(legs.fields).toHaveLength(2);
  });

  it('Trade message has 2 outer varData fields alongside groups', () => {
    const msg = parseSchema(fix('groups.xml')).messages[0]!;
    expect(msg.varData).toHaveLength(2);
    expect(msg.varData.map((v) => v.name)).toEqual(['comment', 'metadata']);
  });

  it('legs group fields have correct types and offsets', () => {
    const legs = parseSchema(fix('groups.xml')).messages[0]!.groups[0]!.groups[0]!;
    expect(legs.fields[0]).toMatchObject({ name: 'legId', type: 'uint16', offset: 0 });
    expect(legs.fields[1]).toMatchObject({ name: 'weight', type: 'uint16', offset: 2 });
  });

  it('schemas without groups have empty groups array', () => {
    const { messages } = parseSchema(fix('market-data.xml'));
    for (const msg of messages) {
      expect(msg.groups).toEqual([]);
    }
  });
});

describe('parseSchema — implicit field offsets', () => {
  it('accumulates offsets when fields have no explicit offset attribute', () => {
    withTempSchema(`<?xml version="1.0" encoding="UTF-8"?>
<sbe:messageSchema xmlns:sbe="http://fixprotocol.io/2016/sbe" package="test" id="1" version="0" byteOrder="littleEndian">
  <sbe:message name="Msg" id="1" blockLength="16">
    <field name="a" id="1" type="uint32"/>
    <field name="b" id="2" type="int64"/>
    <field name="c" id="3" type="uint16"/>
    <field name="d" id="4" type="uint8"/>
  </sbe:message>
</sbe:messageSchema>`, (tmp) => {
      const fields = parseSchema(tmp).messages[0]!.fields;
      expect(fields[0]).toMatchObject({ name: 'a', offset: 0 });
      expect(fields[1]).toMatchObject({ name: 'b', offset: 4 });
      expect(fields[2]).toMatchObject({ name: 'c', offset: 12 });
      expect(fields[3]).toMatchObject({ name: 'd', offset: 14 });
    });
  });
});

describe('parseSchema — field validation', () => {
  it('throws with message name and index when a field is missing a name attribute', () => {
    withTempSchema(`<?xml version="1.0" encoding="UTF-8"?>
<sbe:messageSchema xmlns:sbe="http://fixprotocol.io/2016/sbe" package="test" id="1" version="0" byteOrder="littleEndian">
  <sbe:message name="Msg" id="1" blockLength="4">
    <field id="1" type="uint32" offset="0"/>
  </sbe:message>
</sbe:messageSchema>`, (tmp) => {
      expect(() => parseSchema(tmp)).toThrow('Msg');
      expect(() => parseSchema(tmp)).toThrow('index 0');
    });
  });

  it('throws with field name and file path when a field is missing a type attribute', () => {
    withTempSchema(`<?xml version="1.0" encoding="UTF-8"?>
<sbe:messageSchema xmlns:sbe="http://fixprotocol.io/2016/sbe" package="test" id="1" version="0" byteOrder="littleEndian">
  <sbe:message name="Msg" id="1" blockLength="4">
    <field name="myField" id="1" offset="0"/>
  </sbe:message>
</sbe:messageSchema>`, (tmp) => {
      expect(() => parseSchema(tmp)).toThrow('myField');
      expect(() => parseSchema(tmp)).toThrow(tmp);
    });
  });
});
