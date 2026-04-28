import type { SbeField, SbeVarData, SbeEnum, SbeSet, SbeComposite } from '../parser/types.js';
import { PRIMITIVE_READER, PRIMITIVE_WRITER, capitalize, toDirectMethod, endianArg } from './helpers.js';

export const LENGTH_PREFIX_MAX: Record<string, number> = {
  uint8: 0xff,       int8: 0x7f,
  uint16: 0xffff,    int16: 0x7fff,
  uint32: 0xffffffff, int32: 0x7fffffff,
};

export function varLenReadExpr(type: string, posExpr: string, isBigEndian: boolean): string {
  const r = PRIMITIVE_READER[type];
  if (!r) return `this.view.getUint32(${posExpr}, ${String(!isBigEndian)})`;
  const method = toDirectMethod(r.method);
  const ea = endianArg(type, isBigEndian);
  return `this.view.${method}(${posExpr}${ea})`;
}

export function varLenWriteExpr(type: string, posExpr: string, isBigEndian: boolean): string {
  const w = PRIMITIVE_WRITER[type];
  if (!w) return `this.view.setUint32(${posExpr}, data.length, ${String(!isBigEndian)})`;
  const method = toDirectMethod(w.method);
  const ea = endianArg(type, isBigEndian);
  return `this.view.${method}(${posExpr}, data.length${ea})`;
}

export function fieldDecoder(field: SbeField, isBigEndian: boolean): string {
  const r = PRIMITIVE_READER[field.type]!;
  const method = toDirectMethod(r.method);
  const ea = endianArg(field.type, isBigEndian);
  return `  ${field.name}(): ${r.tsType} { return this.view.${method}(this.offset + ${field.offset}${ea}); }`;
}

export function fieldEncoder(field: SbeField, isBigEndian: boolean): string {
  const w = PRIMITIVE_WRITER[field.type]!;
  const method = toDirectMethod(w.method);
  const ea = endianArg(field.type, isBigEndian);
  return `  set${capitalize(field.name)}(v: ${w.tsType}): this { this.view.${method}(this.offset + ${field.offset}, v${ea}); return this; }`;
}

export function varDataDecoder(vd: SbeVarData, isBigEndian: boolean): string {
  const lenRead = varLenReadExpr(vd.lengthPrimitiveType, 'pos', isBigEndian);
  return [
    `  // VarData fields must be read in schema-declaration order (cursor advances on each call).`,
    `  ${vd.name}(): Uint8Array {`,
    `    const pos = this.offset + this.cursor;`,
    `    const len = ${lenRead};`,
    `    const data = new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, len);`,
    `    this.cursor += ${vd.lengthByteSize} + len;`,
    `    return data;`,
    `  }`,
  ].join('\n');
}

export function varDataDecoderAfterGroup(vd: SbeVarData, lastGroupIterField: string, isBigEndian: boolean): string {
  const lenRead = varLenReadExpr(vd.lengthPrimitiveType, 'pos', isBigEndian);
  return [
    `  // VarData fields must be read in schema-declaration order (cursor advances on each call).`,
    `  ${vd.name}(): Uint8Array {`,
    `    const pos = this.${lastGroupIterField}.absoluteEnd();`,
    `    const len = ${lenRead};`,
    `    const data = new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, len);`,
    `    this.cursor = (pos + ${vd.lengthByteSize} + len) - this.offset;`,
    `    return data;`,
    `  }`,
  ].join('\n');
}

export function varDataEncoder(vd: SbeVarData, isBigEndian: boolean): string {
  const lenWrite = varLenWriteExpr(vd.lengthPrimitiveType, 'pos', isBigEndian);
  const maxLen = LENGTH_PREFIX_MAX[vd.lengthPrimitiveType] ?? 0xffffffff;
  return [
    `  set${capitalize(vd.name)}(data: Uint8Array): this {`,
    `    if (data.length > ${maxLen}) throw new RangeError(\`${vd.name}: payload (\${data.length} bytes) exceeds ${vd.lengthPrimitiveType} prefix capacity\`);`,
    `    const pos = this.offset + this.cursor;`,
    `    ${lenWrite};`,
    `    new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, data.length).set(data);`,
    `    this.cursor += ${vd.lengthByteSize} + data.length;`,
    `    return this;`,
    `  }`,
  ].join('\n');
}

export function varDataEncoderAfterGroup(vd: SbeVarData, lastGroupWriterField: string, isBigEndian: boolean): string {
  const lenWrite = varLenWriteExpr(vd.lengthPrimitiveType, 'pos', isBigEndian);
  const maxLen = LENGTH_PREFIX_MAX[vd.lengthPrimitiveType] ?? 0xffffffff;
  return [
    `  set${capitalize(vd.name)}(data: Uint8Array): this {`,
    `    if (data.length > ${maxLen}) throw new RangeError(\`${vd.name}: payload (\${data.length} bytes) exceeds ${vd.lengthPrimitiveType} prefix capacity\`);`,
    `    const pos = this.${lastGroupWriterField}.absoluteEnd();`,
    `    ${lenWrite};`,
    `    new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, data.length).set(data);`,
    `    this.cursor = (pos + ${vd.lengthByteSize} + data.length) - this.offset;`,
    `    return this;`,
    `  }`,
  ].join('\n');
}

export function makeFieldAccessor(
  f: SbeField,
  enumMap: Map<string, SbeEnum>,
  setMap: Map<string, SbeSet>,
  compositeMap: Map<string, SbeComposite>,
  isBigEndian: boolean,
): string {
  if (f.type in PRIMITIVE_READER) return fieldDecoder(f, isBigEndian);
  if (compositeMap.has(f.type)) {
    const cn = capitalize(f.type);
    return `  ${f.name}(): ${cn}Decoder { return this._${f.name}.wrap(this.view.buffer, this.offset + ${f.offset}); }`;
  }
  if (enumMap.has(f.type)) {
    const e = enumMap.get(f.type)!;
    const en = capitalize(f.type);
    const reader = PRIMITIVE_READER[e.encodingType];
    if (!reader) return `  // skipped: ${f.name} (enum '${f.type}' has unknown encodingType '${e.encodingType}')`;
    const method = toDirectMethod(reader.method);
    const ea = endianArg(e.encodingType, isBigEndian);
    return `  ${f.name}(): ${en} { return this.view.${method}(this.offset + ${f.offset}${ea}) as ${en}; }`;
  }
  if (setMap.has(f.type)) {
    const s = setMap.get(f.type)!;
    const sn = capitalize(f.type);
    const reader = PRIMITIVE_READER[s.encodingType];
    if (!reader) return `  // skipped: ${f.name} (set '${f.type}' has unknown encodingType '${s.encodingType}')`;
    const method = toDirectMethod(reader.method);
    const ea = endianArg(s.encodingType, isBigEndian);
    return `  ${f.name}(): ${sn} { return this.view.${method}(this.offset + ${f.offset}${ea}) as ${sn}; }`;
  }
  return `  // skipped: ${f.name} (type '${f.type}' is not a known type)`;
}

export function makeFieldMutator(
  f: SbeField,
  enumMap: Map<string, SbeEnum>,
  setMap: Map<string, SbeSet>,
  compositeMap: Map<string, SbeComposite>,
  isBigEndian: boolean,
): string {
  if (f.type in PRIMITIVE_WRITER) return fieldEncoder(f, isBigEndian);
  if (compositeMap.has(f.type)) {
    const cn = capitalize(f.type);
    return `  // skipped: ${f.name} (composite — use ${cn}Encoder directly)`;
  }
  if (enumMap.has(f.type)) {
    const e = enumMap.get(f.type)!;
    const en = capitalize(f.type);
    const writer = PRIMITIVE_WRITER[e.encodingType];
    if (!writer) return `  // skipped: ${f.name} (enum '${f.type}' has unknown encodingType '${e.encodingType}')`;
    const method = toDirectMethod(writer.method);
    const ea = endianArg(e.encodingType, isBigEndian);
    return `  set${capitalize(f.name)}(v: ${en}): this { this.view.${method}(this.offset + ${f.offset}, v${ea}); return this; }`;
  }
  if (setMap.has(f.type)) {
    const s = setMap.get(f.type)!;
    const sn = capitalize(f.type);
    const writer = PRIMITIVE_WRITER[s.encodingType];
    if (!writer) return `  // skipped: ${f.name} (set '${f.type}' has unknown encodingType '${s.encodingType}')`;
    const method = toDirectMethod(writer.method);
    const ea = endianArg(s.encodingType, isBigEndian);
    return `  set${capitalize(f.name)}(v: ${sn}): this { this.view.${method}(this.offset + ${f.offset}, v${ea}); return this; }`;
  }
  return `  // skipped: ${f.name} (type '${f.type}' is not a known type)`;
}
