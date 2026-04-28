import type { SbeSchema, SbeMessage, SbeEnum, SbeSet, SbeComposite } from '../parser/types.js';
import { capitalize, PRIMITIVE_READER } from './helpers.js';
import { makeFieldAccessor, makeFieldMutator, varDataDecoder, varDataDecoderAfterGroup, varDataEncoder, varDataEncoderAfterGroup } from './field.js';
import { compositeFieldsOf, generatePreallocFields, generateGroupAccessors, generateGroupEntryClass, collectGroupTypeRefs } from './group.js';

function generateMessage(msg: SbeMessage, schema: SbeSchema, packageName: string): string {
  const compositeMap = new Map(schema.composites.map((c) => [c.name, c]));
  const enumMap = new Map(schema.enums.map((e) => [e.name, e]));
  const setMap = new Map(schema.sets.map((s) => [s.name, s]));

  const grouped = Object.groupBy(msg.fields, (f) => {
    if (f.type in PRIMITIVE_READER) return 'primitive';
    if (compositeMap.has(f.type)) return 'composite';
    if (enumMap.has(f.type)) return 'enum';
    if (setMap.has(f.type)) return 'set';
    return 'skip';
  });

  const refs = {
    enums: new Set((grouped.enum ?? []).map((f) => capitalize(f.type))),
    sets: new Set((grouped.set ?? []).map((f) => capitalize(f.type))),
    composites: new Set((grouped.composite ?? []).map((f) => capitalize(f.type))),
  };
  collectGroupTypeRefs(msg.groups, enumMap, setMap, compositeMap, refs);

  const hasGroups = msg.groups.length > 0;
  const typeImports = [
    ...[...refs.composites].map((cn) => `import { ${cn}Decoder } from './${cn}.js';`),
    ...[...refs.enums].map((en) => `import { ${en} } from './${en}.js';`),
    ...[...refs.sets].map((sn) => `import { ${sn} } from './${sn}.js';`),
  ];

  const isBigEndian = schema.byteOrder === 'bigEndian';
  const ctor = isBigEndian
    ? [`  constructor(buffer: ArrayBufferLike, offset: number) { super(buffer, offset, false); }`, ``]
    : [];

  const hasVarData = msg.varData.length > 0;
  const lastGroupName = hasGroups ? msg.groups[msg.groups.length - 1]!.name : null;

  const decoderLines = msg.fields.map((f) => makeFieldAccessor(f, enumMap, setMap, compositeMap, isBigEndian));
  const encoderLines = msg.fields.map((f) => makeFieldMutator(f, enumMap, setMap, compositeMap, isBigEndian));

  const skipCount = grouped.skip?.length ?? 0;
  const skipNote = skipCount > 0 ? [`  // ${skipCount} unresolvable field(s) skipped`, ``] : [];

  const varDataDecoderLines = msg.varData.map((vd, i) =>
    hasGroups && i === 0
      ? varDataDecoderAfterGroup(vd, `_${lastGroupName}Iter`, isBigEndian)
      : varDataDecoder(vd, isBigEndian),
  );
  const varDataEncoderLines = msg.varData.map((vd, i) =>
    hasGroups && i === 0
      ? varDataEncoderAfterGroup(vd, `_${lastGroupName}Writer`, isBigEndian)
      : varDataEncoder(vd, isBigEndian),
  );

  const decoderWrap = hasVarData
    ? [
        `  override wrap(buffer: ArrayBufferLike, offset: number): this {`,
        `    super.wrap(buffer, offset);`,
        `    this.cursor = ${msg.name}Decoder.BLOCK_LENGTH;`,
        `    return this;`,
        `  }`,
        ``,
      ]
    : [];

  const encoderWrap = hasVarData
    ? [
        `  override wrap(buffer: ArrayBufferLike, offset: number): this {`,
        `    super.wrap(buffer, offset);`,
        `    this.cursor = ${msg.name}Encoder.BLOCK_LENGTH;`,
        `    return this;`,
        `  }`,
        ``,
      ]
    : [];

  const entryClassCode = msg.groups
    .map((g) => generateGroupEntryClass(g, enumMap, setMap, compositeMap, isBigEndian))
    .join('');

  const msgCompositeFields = compositeFieldsOf(msg.fields, compositeMap);
  const decoderPreallocFields = generatePreallocFields(msg.groups, `${msg.name}Decoder`, 'decoder', msgCompositeFields);
  const encoderPreallocFields = generatePreallocFields(msg.groups, `${msg.name}Encoder`, 'encoder');

  const decoderGroupAccessors = generateGroupAccessors(
    msg.groups,
    `this.offset + ${msg.name}Decoder.BLOCK_LENGTH`,
    'decoder',
    isBigEndian,
  );
  const encoderGroupAccessors = generateGroupAccessors(
    msg.groups,
    `this.offset + ${msg.name}Encoder.BLOCK_LENGTH`,
    'encoder',
    isBigEndian,
  );

  const runtimeImports = hasGroups
    ? [`import { MessageFlyweight, GroupIterator, GroupWriter } from 'sbe-ts';`]
    : [`import { MessageFlyweight } from 'sbe-ts';`];

  return [
    `// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.`,
    `// Package: ${packageName || schema.package}  Schema ID: ${schema.id}  Version: ${schema.version}`,
    ...runtimeImports,
    ...typeImports,
    ``,
    ...(entryClassCode ? [entryClassCode] : []),
    `export class ${msg.name}Decoder extends MessageFlyweight {`,
    `  static readonly BLOCK_LENGTH = ${msg.blockLength};`,
    `  static readonly TEMPLATE_ID  = ${msg.id};`,
    `  static readonly SCHEMA_ID    = ${schema.id};`,
    `  static readonly VERSION      = ${schema.version};`,
    ``,
    ...ctor,
    ...(decoderPreallocFields.length > 0 ? [...decoderPreallocFields, ``] : []),
    ...decoderWrap,
    ...skipNote,
    ...decoderLines,
    ...(decoderGroupAccessors.length > 0 ? [``, ...decoderGroupAccessors] : []),
    ...(varDataDecoderLines.length > 0 ? [``, ...varDataDecoderLines] : []),
    `}`,
    ``,
    `export class ${msg.name}Encoder extends MessageFlyweight {`,
    `  static readonly BLOCK_LENGTH = ${msg.blockLength};`,
    ``,
    ...ctor,
    ...(encoderPreallocFields.length > 0 ? [...encoderPreallocFields, ``] : []),
    ...encoderWrap,
    ...encoderLines,
    ...(encoderGroupAccessors.length > 0 ? [``, ...encoderGroupAccessors] : []),
    ...(varDataEncoderLines.length > 0 ? [``, ...varDataEncoderLines] : []),
    `}`,
    ``,
  ].join('\n');
}

export interface GeneratedFile {
  name: string;
  content: string;
}

export function generateAll(schema: SbeSchema, packageName: string): GeneratedFile[] {
  return schema.messages.map((msg) => ({
    name: `${msg.name}.ts`,
    content: generateMessage(msg, schema, packageName),
  }));
}
