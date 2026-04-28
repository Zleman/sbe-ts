import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import type { SbeSchema, SbeMessage, SbeField, SbeComposite, SbeCompositeField, SbeEnum, SbeSet, SbeVarData, SbeGroup, ByteOrder } from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  trimValues: true,
  isArray: (tagName) =>
    ['sbe:message', 'field', 'composite', 'type', 'enum', 'validValue',
     'set', 'choice', 'data', 'group', 'ref', 'types'].includes(tagName),
});

const PRIMITIVE_BYTE_SIZE: Record<string, number> = {
  int8: 1, uint8: 1, char: 1,
  int16: 2, uint16: 2, float16: 2,
  int32: 4, uint32: 4, float: 4,
  int64: 8, uint64: 8, double: 8,
};

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v as unknown[];
  if (v != null) return [v];
  return [];
}

interface ParseContext {
  typeAliasMap: Map<string, { primitiveType: string; length: number }>;
  compositeMap: Map<string, SbeComposite>;
  enumMap: Map<string, SbeEnum>;
  setMap: Map<string, SbeSet>;
}

function getFieldByteSize(type: string, ctx: ParseContext): number {
  if (type in PRIMITIVE_BYTE_SIZE) return PRIMITIVE_BYTE_SIZE[type]!;
  const alias = ctx.typeAliasMap.get(type);
  if (alias) return (PRIMITIVE_BYTE_SIZE[alias.primitiveType] ?? 1) * alias.length;
  const en = ctx.enumMap.get(type);
  if (en) return PRIMITIVE_BYTE_SIZE[en.encodingType] ?? 1;
  const st = ctx.setMap.get(type);
  if (st) return PRIMITIVE_BYTE_SIZE[st.encodingType] ?? 1;
  const comp = ctx.compositeMap.get(type);
  if (comp) {
    return comp.fields
      .filter((f) => !f.isConstant)
      .reduce((sum, f) => {
        const sz = f.byteSize !== undefined
          ? f.byteSize
          : getFieldByteSize(f.primitiveType, ctx) * (f.length ?? 1);
        return sum + sz;
      }, 0);
  }
  return 1;
}

function resolveFieldType(type: string, ctx: ParseContext): string {
  const alias = ctx.typeAliasMap.get(type);
  if (alias && alias.length === 1) return alias.primitiveType;
  return type;
}

function parseGroupFields(rawFields: unknown[], ctx: ParseContext): SbeField[] {
  let cursor = 0;
  return rawFields.map((f) => {
    const field = f as Record<string, unknown>;
    const name = (field['@_name'] as string) ?? '';
    const rawType = (field['@_type'] as string) ?? '';
    const id = Number(field['@_id'] ?? 0);
    const hasExplicitOffset = field['@_offset'] !== undefined;
    const offset = hasExplicitOffset ? Number(field['@_offset']) : cursor;
    const size = getFieldByteSize(rawType, ctx);
    cursor = offset + size;
    return { name, id, type: resolveFieldType(rawType, ctx), offset };
  });
}

function parseVarData(rawDataEls: unknown[], ctx: ParseContext): SbeVarData[] {
  return rawDataEls.map((d) => {
    const el = d as Record<string, unknown>;
    const name = (el['@_name'] as string) ?? '';
    const id = Number(el['@_id'] ?? 0);
    const type = (el['@_type'] as string) ?? '';
    const comp = ctx.compositeMap.get(type);
    const lengthPrimitiveType = comp?.fields[0]?.primitiveType ?? 'uint32';
    const lengthByteSize = PRIMITIVE_BYTE_SIZE[lengthPrimitiveType] ?? 4;
    return { name, id, type, lengthPrimitiveType, lengthByteSize };
  });
}

function parseGroup(raw: Record<string, unknown>, ctx: ParseContext): SbeGroup {
  const name = (raw['@_name'] as string) ?? '';
  const id = Number(raw['@_id'] ?? 0);
  const dimensionType = (raw['@_dimensionType'] as string) ?? 'groupSizeEncoding';

  const fields = parseGroupFields(asArray(raw['field']), ctx);

  const blockLengthAttr = raw['@_blockLength'];
  const blockLength =
    blockLengthAttr !== undefined
      ? Number(blockLengthAttr)
      : fields.reduce((max, f) => Math.max(max, f.offset + getFieldByteSize(f.type, ctx)), 0);

  const groups = asArray(raw['group']).map((g) => parseGroup(g as Record<string, unknown>, ctx));
  const varData = parseVarData(asArray(raw['data']), ctx);

  const dimComp = ctx.compositeMap.get(dimensionType);
  let numInGroupOffset = 2;
  let numInGroupPrimitive = 'uint16';
  let headerSize = 4;
  if (dimComp) {
    let cur = 0;
    for (const f of dimComp.fields) {
      const fsz =
        f.byteSize !== undefined
          ? f.byteSize
          : (PRIMITIVE_BYTE_SIZE[f.primitiveType] ?? 1) * (f.length ?? 1);
      if (f.name === 'numInGroup') {
        numInGroupOffset = cur;
        numInGroupPrimitive = f.primitiveType;
      }
      cur += fsz;
    }
    headerSize = cur;
  }

  return { name, id, blockLength, dimensionType, numInGroupOffset, numInGroupPrimitive, headerSize, fields, groups, varData };
}

export function parseSchema(filePath: string): SbeSchema {
  const xml = readFileSync(filePath, 'utf-8').trim();
  const doc = parser.parse(xml);
  const root = doc['sbe:messageSchema'];

  if (!root) {
    throw new Error(`No <sbe:messageSchema> root element found in ${filePath}`);
  }

  const byteOrder: ByteOrder =
    root['@_byteOrder'] === 'bigEndian' ? 'bigEndian' : 'littleEndian';

  const composites: SbeComposite[] = [];
  const enums: SbeEnum[] = [];
  const sets: SbeSet[] = [];
  const typeAliasMap = new Map<string, { primitiveType: string; length: number }>();

  const typesBlocks = asArray(root['types']);

  for (const rawBlock of typesBlocks) {
    const tb = rawBlock as Record<string, unknown>;

    // --- Named <type> aliases (e.g. <type name="ModelYear" primitiveType="uint16"/>) ---
    for (const t of asArray(tb['type'])) {
      const ta = t as Record<string, unknown>;
      const aliasName = ta['@_name'] as string | undefined;
      const primitiveType = ta['@_primitiveType'] as string | undefined;
      if (!aliasName || !primitiveType) continue;
      const length = ta['@_length'] !== undefined ? Number(ta['@_length']) : 1;
      typeAliasMap.set(aliasName, { primitiveType, length });
    }

    // --- <composite> elements ---
    for (const c of asArray(tb['composite'])) {
      const comp = c as Record<string, unknown>;
      const compName = comp['@_name'] as string | undefined;
      if (!compName) continue;

      const allFields: SbeCompositeField[] = [];

      // <type> children (scalar and array fields, possibly with presence="constant")
      for (const t of asArray(comp['type'])) {
        const f = t as Record<string, unknown>;
        const name = f['@_name'] as string | undefined;
        const primitiveType = f['@_primitiveType'] as string | undefined;
        if (!name || !primitiveType) continue;
        const isConstant = f['@_presence'] === 'constant';
        const length = f['@_length'] !== undefined ? Number(f['@_length']) : 1;
        const sz = PRIMITIVE_BYTE_SIZE[primitiveType] ?? 1;
        allFields.push({
          name,
          primitiveType,
          length,
          byteSize: isConstant ? 0 : sz * length,
          isConstant,
        });
      }

      // <ref> children (references to other named types, e.g. <ref name="efficiency" type="Percentage"/>)
      for (const r of asArray(comp['ref'])) {
        const f = r as Record<string, unknown>;
        const name = f['@_name'] as string | undefined;
        const refType = f['@_type'] as string | undefined;
        if (!name || !refType) continue;
        allFields.push({ name, primitiveType: refType, length: 1, byteSize: undefined, isConstant: false });
      }

      // inline <enum> children (e.g. BoostType enum inside Booster composite)
      for (const e of asArray(comp['enum'])) {
        const f = e as Record<string, unknown>;
        const name = f['@_name'] as string | undefined;
        const encodingType = f['@_encodingType'] as string | undefined;
        if (!name || !encodingType) continue;
        const sz = PRIMITIVE_BYTE_SIZE[encodingType] ?? 1;
        allFields.push({ name, primitiveType: encodingType, length: 1, byteSize: sz, isConstant: false });
      }

      composites.push({ name: compName, fields: allFields });
    }

    // --- <set> elements ---
    for (const s of asArray(tb['set'])) {
      const st = s as Record<string, unknown>;
      sets.push({
        name: st['@_name'] as string,
        encodingType: st['@_encodingType'] as string,
        choices: asArray(st['choice']).map((c) => {
          const ch = c as Record<string, unknown>;
          return { name: ch['@_name'] as string, bitIndex: Number(ch['#text']) };
        }),
      });
    }

    // --- <enum> elements ---
    for (const e of asArray(tb['enum'])) {
      const en = e as Record<string, unknown>;
      enums.push({
        name: en['@_name'] as string,
        encodingType: en['@_encodingType'] as string,
        values: asArray(en['validValue']).map((v) => {
          const val = v as Record<string, unknown>;
          const textVal = String(val['#text'] ?? '');
          const value = /^-?\d+$/.test(textVal.trim()) ? Number(textVal) : textVal.charCodeAt(0);
          return { name: val['@_name'] as string, value };
        }),
      });
    }
  }

  const compositeMap = new Map(composites.map((c) => [c.name, c]));
  const enumMap = new Map(enums.map((e) => [e.name, e]));
  const setMap = new Map(sets.map((s) => [s.name, s]));
  const ctx: ParseContext = { typeAliasMap, compositeMap, enumMap, setMap };

  const rawMessages = asArray(root['sbe:message']);
  const messages: SbeMessage[] = rawMessages.map((m, msgIdx) => {
    const msg = m as Record<string, unknown>;
    const msgName = msg['@_name'] as string | undefined;
    if (!msgName) {
      throw new Error(
        `Schema message at index ${msgIdx} is missing a "name" attribute in ${filePath}`,
      );
    }

    let msgFieldCursor = 0;
    const fields: SbeField[] = asArray(msg['field']).map((f, fieldIdx) => {
      const field = f as Record<string, unknown>;
      const name = field['@_name'] as string | undefined;
      const rawType = field['@_type'] as string | undefined;
      if (!name) {
        throw new Error(
          `Message "${msgName}" field at index ${fieldIdx} is missing a "name" attribute in ${filePath}`,
        );
      }
      if (!rawType) {
        throw new Error(
          `Message "${msgName}" field "${name}" is missing a "type" attribute in ${filePath}`,
        );
      }
      const hasExplicitOffset = field['@_offset'] !== undefined;
      const offset = hasExplicitOffset ? Number(field['@_offset']) : msgFieldCursor;
      const size = getFieldByteSize(rawType, ctx);
      msgFieldCursor = offset + size;
      return { name, id: Number(field['@_id']), type: resolveFieldType(rawType, ctx), offset };
    });

    const groups = asArray(msg['group']).map((g) => parseGroup(g as Record<string, unknown>, ctx));
    const varData = parseVarData(asArray(msg['data']), ctx);

    const blockLengthAttr = msg['@_blockLength'];
    const blockLength =
      blockLengthAttr !== undefined
        ? Number(blockLengthAttr)
        : fields.reduce((max, f) => Math.max(max, f.offset + getFieldByteSize(f.type, ctx)), 0);

    return {
      name: msgName,
      id: Number(msg['@_id']),
      blockLength,
      fields,
      groups,
      varData,
    };
  });

  return {
    package: (root['@_package'] as string) ?? '',
    id: Number(root['@_id'] ?? 0),
    version: Number(root['@_version'] ?? 0),
    byteOrder,
    messages,
    composites,
    enums,
    sets,
  };
}
