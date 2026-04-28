import type { SbeField, SbeGroup, SbeEnum, SbeSet, SbeComposite } from '../parser/types.js';
import { PRIMITIVE_READER, PRIMITIVE_WRITER, capitalize, toDirectMethod, endianArg } from './helpers.js';
import { makeFieldAccessor, makeFieldMutator, varDataDecoder, varDataDecoderAfterGroup, varDataEncoder, varDataEncoderAfterGroup, varLenReadExpr } from './field.js';

export function compositeFieldsOf(fields: SbeField[], compositeMap: Map<string, SbeComposite>): SbeField[] {
  return fields.filter((f) => compositeMap.has(f.type));
}

export function generatePreallocFields(
  groups: SbeGroup[],
  ownerClass: string,
  mode: 'decoder' | 'encoder' | 'entry',
  compositeFields: SbeField[] = [],
): string[] {
  if (groups.length === 0 && compositeFields.length === 0) return [];
  const lines: string[] = [`  private static readonly _EMPTY = new ArrayBuffer(0);`];
  for (const g of groups) {
    const entryName = `${capitalize(g.name)}Entry`;
    lines.push(`  private readonly _${g.name}Entry = new ${entryName}(${ownerClass}._EMPTY, 0);`);
    if (mode !== 'encoder') {
      lines.push(`  private readonly _${g.name}Iter = new GroupIterator(this._${g.name}Entry);`);
    }
    if (mode !== 'decoder') {
      lines.push(`  private readonly _${g.name}Writer = new GroupWriter(this._${g.name}Entry);`);
    }
  }
  if (mode !== 'encoder') {
    for (const f of compositeFields) {
      const cn = capitalize(f.type);
      lines.push(`  private readonly _${f.name} = new ${cn}Decoder(${ownerClass}._EMPTY, 0);`);
    }
  }
  return lines;
}

function generateGroupDecoderMethod(group: SbeGroup, startExpr: string, isBigEndian: boolean): string {
  const entryName = `${capitalize(group.name)}Entry`;
  const numReadMethod = toDirectMethod(PRIMITIVE_READER[group.numInGroupPrimitive]?.method ?? 'getUint16');
  const ea = endianArg(group.numInGroupPrimitive, isBigEndian);
  return [
    `  ${group.name}(): GroupIterator<${entryName}> {`,
    `    const hdrOff = ${startExpr};`,
    `    const view = this.view;`,
    `    const numInGroup = view.${numReadMethod}(hdrOff + ${group.numInGroupOffset}${ea});`,
    `    return this._${group.name}Iter.reset(view.buffer, hdrOff + ${group.headerSize}, numInGroup);`,
    `  }`,
  ].join('\n');
}

function generateGroupEncoderMethod(group: SbeGroup, startExpr: string, isBigEndian: boolean): string {
  const entryName = `${capitalize(group.name)}Entry`;
  const numWriteMethod = toDirectMethod(PRIMITIVE_WRITER[group.numInGroupPrimitive]?.method ?? 'setUint16');
  const blEa = endianArg('uint16', isBigEndian);
  const ea = endianArg(group.numInGroupPrimitive, isBigEndian);
  return [
    `  ${group.name}Count(numInGroup: number): GroupWriter<${entryName}> {`,
    `    const hdrOff = ${startExpr};`,
    `    const view = this.view;`,
    `    view.setUint16(hdrOff, ${entryName}.BLOCK_LENGTH${blEa});`,
    `    view.${numWriteMethod}(hdrOff + ${group.numInGroupOffset}, numInGroup${ea});`,
    `    return this._${group.name}Writer.reset(view.buffer, hdrOff + ${group.headerSize}, numInGroup);`,
    `  }`,
  ].join('\n');
}

export function generateGroupAccessors(
  groups: SbeGroup[],
  parentExpr: string,
  mode: 'decoder' | 'encoder',
  isBigEndian: boolean,
): string[] {
  return groups.map((g, i) => {
    const startExpr = i === 0
      ? parentExpr
      : mode === 'decoder'
        ? `this._${groups[i - 1]!.name}Iter.absoluteEnd()`
        : `this._${groups[i - 1]!.name}Writer.absoluteEnd()`;
    return mode === 'decoder'
      ? generateGroupDecoderMethod(g, startExpr, isBigEndian)
      : generateGroupEncoderMethod(g, startExpr, isBigEndian);
  });
}

export function generateAbsoluteEndBody(group: SbeGroup, entryName: string, isBigEndian: boolean): string[] {
  if (group.groups.length === 0 && group.varData.length === 0) {
    return [`    return this.offset + ${entryName}.BLOCK_LENGTH;`];
  }

  const lines: string[] = [];
  let posExpr = `(this.offset + ${entryName}.BLOCK_LENGTH)`;

  for (let i = 0; i < group.groups.length; i++) {
    const ng = group.groups[i]!;
    const hdrVar = `hdr${i}`;
    const nVar = `n${i}`;
    const isLast = i === group.groups.length - 1;

    const ngNumMethod = toDirectMethod(PRIMITIVE_READER[ng.numInGroupPrimitive]?.method ?? 'getUint16');
    const ngEa = endianArg(ng.numInGroupPrimitive, isBigEndian);
    const ngNumExpr = `this.view.${ngNumMethod}(${hdrVar} + ${ng.numInGroupOffset}${ngEa})`;
    lines.push(`    const ${hdrVar} = ${posExpr};`);
    lines.push(`    const ${nVar} = ${ngNumExpr};`);

    if (isLast && group.varData.length === 0) {
      lines.push(`    return this._${ng.name}Iter.reset(this.view.buffer, ${hdrVar} + ${ng.headerSize}, ${nVar}).absoluteEnd();`);
      return lines;
    }
    const endVar = `end${i}`;
    lines.push(`    const ${endVar} = this._${ng.name}Iter.reset(this.view.buffer, ${hdrVar} + ${ng.headerSize}, ${nVar}).absoluteEnd();`);
    posExpr = endVar;
  }

  if (group.groups.length === 0) {
    lines.push(`    let c = ${entryName}.BLOCK_LENGTH;`);
  } else {
    lines.push(`    let c = ${posExpr} - this.offset;`);
  }
  for (const vd of group.varData) {
    const lenRead = varLenReadExpr(vd.lengthPrimitiveType, 'this.offset + c', isBigEndian);
    lines.push(`    c += ${vd.lengthByteSize} + ${lenRead};`);
  }
  lines.push(`    return this.offset + c;`);
  return lines;
}

export function generateGroupEntryClass(
  group: SbeGroup,
  enumMap: Map<string, SbeEnum>,
  setMap: Map<string, SbeSet>,
  compositeMap: Map<string, SbeComposite>,
  isBigEndian: boolean,
): string {
  const entryName = `${capitalize(group.name)}Entry`;

  const nestedCode = group.groups
    .map((ng) => generateGroupEntryClass(ng, enumMap, setMap, compositeMap, isBigEndian))
    .join('');

  const entryCompositeFields = compositeFieldsOf(group.fields, compositeMap);
  const nestedPrealloc = generatePreallocFields(group.groups, entryName, 'entry', entryCompositeFields);
  const ctor = isBigEndian
    ? [`  constructor(buffer: ArrayBufferLike, offset: number) { super(buffer, offset, false); }`, ``]
    : [];

  const hasEntryVarData = group.varData.length > 0;
  const wrapOverride = hasEntryVarData
    ? [
        `  override wrap(buffer: ArrayBufferLike, offset: number): this {`,
        `    super.wrap(buffer, offset);`,
        `    this.cursor = ${entryName}.BLOCK_LENGTH;`,
        `    return this;`,
        `  }`,
        ``,
      ]
    : [];

  const lastNestedGroupName = group.groups.length > 0 ? group.groups[group.groups.length - 1]!.name : null;

  const fieldDecoderLines = group.fields.map((f) => makeFieldAccessor(f, enumMap, setMap, compositeMap, isBigEndian));
  const fieldEncoderLines = group.fields.map((f) => makeFieldMutator(f, enumMap, setMap, compositeMap, isBigEndian));

  const varDataDecoderLines = group.varData.map((vd, i) =>
    lastNestedGroupName && i === 0
      ? varDataDecoderAfterGroup(vd, `_${lastNestedGroupName}Iter`, isBigEndian)
      : varDataDecoder(vd, isBigEndian),
  );
  const varDataEncoderLines = group.varData.map((vd, i) =>
    lastNestedGroupName && i === 0
      ? varDataEncoderAfterGroup(vd, `_${lastNestedGroupName}Writer`, isBigEndian)
      : varDataEncoder(vd, isBigEndian),
  );

  const groupDecoderAccessors = generateGroupAccessors(
    group.groups,
    `this.offset + ${entryName}.BLOCK_LENGTH`,
    'decoder',
    isBigEndian,
  );
  const groupEncoderAccessors = generateGroupAccessors(
    group.groups,
    `this.offset + ${entryName}.BLOCK_LENGTH`,
    'encoder',
    isBigEndian,
  );
  const absoluteEndBody = generateAbsoluteEndBody(group, entryName, isBigEndian);

  const lines = [
    `class ${entryName} extends MessageFlyweight {`,
    `  static readonly BLOCK_LENGTH = ${group.blockLength};`,
    ``,
    ...(nestedPrealloc.length > 0 ? [...nestedPrealloc, ``] : []),
    ...ctor,
    ...wrapOverride,
    ...fieldDecoderLines,
    ...(fieldEncoderLines.length > 0 ? [``, ...fieldEncoderLines] : []),
    ...(varDataDecoderLines.length > 0 ? [``, ...varDataDecoderLines] : []),
    ...(varDataEncoderLines.length > 0 ? [``, ...varDataEncoderLines] : []),
    ...(groupDecoderAccessors.length > 0 ? [``, ...groupDecoderAccessors] : []),
    ...(groupEncoderAccessors.length > 0 ? [``, ...groupEncoderAccessors] : []),
    ``,
    `  absoluteEnd(): number {`,
    ...absoluteEndBody,
    `  }`,
    `}`,
    ``,
  ];

  return nestedCode + lines.join('\n');
}

export function collectGroupTypeRefs(
  groups: SbeGroup[],
  enumMap: Map<string, SbeEnum>,
  setMap: Map<string, SbeSet>,
  compositeMap: Map<string, SbeComposite>,
  refs: { enums: Set<string>; sets: Set<string>; composites: Set<string> },
): void {
  for (const g of groups) {
    for (const f of g.fields) {
      if (enumMap.has(f.type)) refs.enums.add(capitalize(f.type));
      else if (setMap.has(f.type)) refs.sets.add(capitalize(f.type));
      else if (compositeMap.has(f.type)) refs.composites.add(capitalize(f.type));
    }
    collectGroupTypeRefs(g.groups, enumMap, setMap, compositeMap, refs);
  }
}
