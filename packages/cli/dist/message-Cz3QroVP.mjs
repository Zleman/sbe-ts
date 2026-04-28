#!/usr/bin/env node
import { a as toDirectMethod, i as endianArg, n as PRIMITIVE_WRITER, r as capitalize, t as PRIMITIVE_READER } from "./helpers-CO4clmJF.mjs";
//#region src/codegen/field.ts
const LENGTH_PREFIX_MAX = {
	uint8: 255,
	int8: 127,
	uint16: 65535,
	int16: 32767,
	uint32: 4294967295,
	int32: 2147483647
};
function varLenReadExpr(type, posExpr, isBigEndian) {
	const r = PRIMITIVE_READER[type];
	if (!r) return `this.view.getUint32(${posExpr}, ${String(!isBigEndian)})`;
	return `this.view.${toDirectMethod(r.method)}(${posExpr}${endianArg(type, isBigEndian)})`;
}
function varLenWriteExpr(type, posExpr, isBigEndian) {
	const w = PRIMITIVE_WRITER[type];
	if (!w) return `this.view.setUint32(${posExpr}, data.length, ${String(!isBigEndian)})`;
	return `this.view.${toDirectMethod(w.method)}(${posExpr}, data.length${endianArg(type, isBigEndian)})`;
}
function fieldDecoder(field, isBigEndian) {
	const r = PRIMITIVE_READER[field.type];
	const method = toDirectMethod(r.method);
	const ea = endianArg(field.type, isBigEndian);
	return `  ${field.name}(): ${r.tsType} { return this.view.${method}(this.offset + ${field.offset}${ea}); }`;
}
function fieldEncoder(field, isBigEndian) {
	const w = PRIMITIVE_WRITER[field.type];
	const method = toDirectMethod(w.method);
	const ea = endianArg(field.type, isBigEndian);
	return `  set${capitalize(field.name)}(v: ${w.tsType}): this { this.view.${method}(this.offset + ${field.offset}, v${ea}); return this; }`;
}
function varDataDecoder(vd, isBigEndian) {
	const lenRead = varLenReadExpr(vd.lengthPrimitiveType, "pos", isBigEndian);
	return [
		`  // VarData fields must be read in schema-declaration order (cursor advances on each call).`,
		`  ${vd.name}(): Uint8Array {`,
		`    const pos = this.offset + this.cursor;`,
		`    const len = ${lenRead};`,
		`    const data = new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, len);`,
		`    this.cursor += ${vd.lengthByteSize} + len;`,
		`    return data;`,
		`  }`
	].join("\n");
}
function varDataDecoderAfterGroup(vd, lastGroupIterField, isBigEndian) {
	const lenRead = varLenReadExpr(vd.lengthPrimitiveType, "pos", isBigEndian);
	return [
		`  // VarData fields must be read in schema-declaration order (cursor advances on each call).`,
		`  ${vd.name}(): Uint8Array {`,
		`    const pos = this.${lastGroupIterField}.absoluteEnd();`,
		`    const len = ${lenRead};`,
		`    const data = new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, len);`,
		`    this.cursor = (pos + ${vd.lengthByteSize} + len) - this.offset;`,
		`    return data;`,
		`  }`
	].join("\n");
}
function varDataEncoder(vd, isBigEndian) {
	const lenWrite = varLenWriteExpr(vd.lengthPrimitiveType, "pos", isBigEndian);
	const maxLen = LENGTH_PREFIX_MAX[vd.lengthPrimitiveType] ?? 4294967295;
	return [
		`  set${capitalize(vd.name)}(data: Uint8Array): this {`,
		`    if (data.length > ${maxLen}) throw new RangeError(\`${vd.name}: payload (\${data.length} bytes) exceeds ${vd.lengthPrimitiveType} prefix capacity\`);`,
		`    const pos = this.offset + this.cursor;`,
		`    ${lenWrite};`,
		`    new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, data.length).set(data);`,
		`    this.cursor += ${vd.lengthByteSize} + data.length;`,
		`    return this;`,
		`  }`
	].join("\n");
}
function varDataEncoderAfterGroup(vd, lastGroupWriterField, isBigEndian) {
	const lenWrite = varLenWriteExpr(vd.lengthPrimitiveType, "pos", isBigEndian);
	const maxLen = LENGTH_PREFIX_MAX[vd.lengthPrimitiveType] ?? 4294967295;
	return [
		`  set${capitalize(vd.name)}(data: Uint8Array): this {`,
		`    if (data.length > ${maxLen}) throw new RangeError(\`${vd.name}: payload (\${data.length} bytes) exceeds ${vd.lengthPrimitiveType} prefix capacity\`);`,
		`    const pos = this.${lastGroupWriterField}.absoluteEnd();`,
		`    ${lenWrite};`,
		`    new Uint8Array(this.view.buffer, pos + ${vd.lengthByteSize}, data.length).set(data);`,
		`    this.cursor = (pos + ${vd.lengthByteSize} + data.length) - this.offset;`,
		`    return this;`,
		`  }`
	].join("\n");
}
function makeFieldAccessor(f, enumMap, setMap, compositeMap, isBigEndian) {
	if (f.type in PRIMITIVE_READER) return fieldDecoder(f, isBigEndian);
	if (compositeMap.has(f.type)) {
		const cn = capitalize(f.type);
		return `  ${f.name}(): ${cn}Decoder { return this._${f.name}.wrap(this.view.buffer, this.offset + ${f.offset}); }`;
	}
	if (enumMap.has(f.type)) {
		const e = enumMap.get(f.type);
		const en = capitalize(f.type);
		const reader = PRIMITIVE_READER[e.encodingType];
		if (!reader) return `  // skipped: ${f.name} (enum '${f.type}' has unknown encodingType '${e.encodingType}')`;
		const method = toDirectMethod(reader.method);
		const ea = endianArg(e.encodingType, isBigEndian);
		return `  ${f.name}(): ${en} { return this.view.${method}(this.offset + ${f.offset}${ea}) as ${en}; }`;
	}
	if (setMap.has(f.type)) {
		const s = setMap.get(f.type);
		const sn = capitalize(f.type);
		const reader = PRIMITIVE_READER[s.encodingType];
		if (!reader) return `  // skipped: ${f.name} (set '${f.type}' has unknown encodingType '${s.encodingType}')`;
		const method = toDirectMethod(reader.method);
		const ea = endianArg(s.encodingType, isBigEndian);
		return `  ${f.name}(): ${sn} { return this.view.${method}(this.offset + ${f.offset}${ea}) as ${sn}; }`;
	}
	return `  // skipped: ${f.name} (type '${f.type}' is not a known type)`;
}
function makeFieldMutator(f, enumMap, setMap, compositeMap, isBigEndian) {
	if (f.type in PRIMITIVE_WRITER) return fieldEncoder(f, isBigEndian);
	if (compositeMap.has(f.type)) {
		const cn = capitalize(f.type);
		return `  // skipped: ${f.name} (composite — use ${cn}Encoder directly)`;
	}
	if (enumMap.has(f.type)) {
		const e = enumMap.get(f.type);
		const en = capitalize(f.type);
		const writer = PRIMITIVE_WRITER[e.encodingType];
		if (!writer) return `  // skipped: ${f.name} (enum '${f.type}' has unknown encodingType '${e.encodingType}')`;
		const method = toDirectMethod(writer.method);
		const ea = endianArg(e.encodingType, isBigEndian);
		return `  set${capitalize(f.name)}(v: ${en}): this { this.view.${method}(this.offset + ${f.offset}, v${ea}); return this; }`;
	}
	if (setMap.has(f.type)) {
		const s = setMap.get(f.type);
		const sn = capitalize(f.type);
		const writer = PRIMITIVE_WRITER[s.encodingType];
		if (!writer) return `  // skipped: ${f.name} (set '${f.type}' has unknown encodingType '${s.encodingType}')`;
		const method = toDirectMethod(writer.method);
		const ea = endianArg(s.encodingType, isBigEndian);
		return `  set${capitalize(f.name)}(v: ${sn}): this { this.view.${method}(this.offset + ${f.offset}, v${ea}); return this; }`;
	}
	return `  // skipped: ${f.name} (type '${f.type}' is not a known type)`;
}
//#endregion
//#region src/codegen/group.ts
function compositeFieldsOf(fields, compositeMap) {
	return fields.filter((f) => compositeMap.has(f.type));
}
function generatePreallocFields(groups, ownerClass, mode, compositeFields = []) {
	if (groups.length === 0 && compositeFields.length === 0) return [];
	const lines = [`  private static readonly _EMPTY = new ArrayBuffer(0);`];
	for (const g of groups) {
		const entryName = `${capitalize(g.name)}Entry`;
		lines.push(`  private readonly _${g.name}Entry = new ${entryName}(${ownerClass}._EMPTY, 0);`);
		if (mode !== "encoder") lines.push(`  private readonly _${g.name}Iter = new GroupIterator(this._${g.name}Entry);`);
		if (mode !== "decoder") lines.push(`  private readonly _${g.name}Writer = new GroupWriter(this._${g.name}Entry);`);
	}
	if (mode !== "encoder") for (const f of compositeFields) {
		const cn = capitalize(f.type);
		lines.push(`  private readonly _${f.name} = new ${cn}Decoder(${ownerClass}._EMPTY, 0);`);
	}
	return lines;
}
function generateGroupDecoderMethod(group, startExpr, isBigEndian) {
	const entryName = `${capitalize(group.name)}Entry`;
	const numReadMethod = toDirectMethod(PRIMITIVE_READER[group.numInGroupPrimitive]?.method ?? "getUint16");
	const ea = endianArg(group.numInGroupPrimitive, isBigEndian);
	return [
		`  ${group.name}(): GroupIterator<${entryName}> {`,
		`    const hdrOff = ${startExpr};`,
		`    const view = this.view;`,
		`    const numInGroup = view.${numReadMethod}(hdrOff + ${group.numInGroupOffset}${ea});`,
		`    return this._${group.name}Iter.reset(view.buffer, hdrOff + ${group.headerSize}, numInGroup);`,
		`  }`
	].join("\n");
}
function generateGroupEncoderMethod(group, startExpr, isBigEndian) {
	const entryName = `${capitalize(group.name)}Entry`;
	const numWriteMethod = toDirectMethod(PRIMITIVE_WRITER[group.numInGroupPrimitive]?.method ?? "setUint16");
	const blEa = endianArg("uint16", isBigEndian);
	const ea = endianArg(group.numInGroupPrimitive, isBigEndian);
	return [
		`  ${group.name}Count(numInGroup: number): GroupWriter<${entryName}> {`,
		`    const hdrOff = ${startExpr};`,
		`    const view = this.view;`,
		`    view.setUint16(hdrOff, ${entryName}.BLOCK_LENGTH${blEa});`,
		`    view.${numWriteMethod}(hdrOff + ${group.numInGroupOffset}, numInGroup${ea});`,
		`    return this._${group.name}Writer.reset(view.buffer, hdrOff + ${group.headerSize}, numInGroup);`,
		`  }`
	].join("\n");
}
function generateGroupAccessors(groups, parentExpr, mode, isBigEndian) {
	return groups.map((g, i) => {
		const startExpr = i === 0 ? parentExpr : mode === "decoder" ? `this._${groups[i - 1].name}Iter.absoluteEnd()` : `this._${groups[i - 1].name}Writer.absoluteEnd()`;
		return mode === "decoder" ? generateGroupDecoderMethod(g, startExpr, isBigEndian) : generateGroupEncoderMethod(g, startExpr, isBigEndian);
	});
}
function generateAbsoluteEndBody(group, entryName, isBigEndian) {
	if (group.groups.length === 0 && group.varData.length === 0) return [`    return this.offset + ${entryName}.BLOCK_LENGTH;`];
	const lines = [];
	let posExpr = `(this.offset + ${entryName}.BLOCK_LENGTH)`;
	for (let i = 0; i < group.groups.length; i++) {
		const ng = group.groups[i];
		const hdrVar = `hdr${i}`;
		const nVar = `n${i}`;
		const isLast = i === group.groups.length - 1;
		const ngNumMethod = toDirectMethod(PRIMITIVE_READER[ng.numInGroupPrimitive]?.method ?? "getUint16");
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
	if (group.groups.length === 0) lines.push(`    let c = ${entryName}.BLOCK_LENGTH;`);
	else lines.push(`    let c = ${posExpr} - this.offset;`);
	for (const vd of group.varData) {
		const lenRead = varLenReadExpr(vd.lengthPrimitiveType, "this.offset + c", isBigEndian);
		lines.push(`    c += ${vd.lengthByteSize} + ${lenRead};`);
	}
	lines.push(`    return this.offset + c;`);
	return lines;
}
function generateGroupEntryClass(group, enumMap, setMap, compositeMap, isBigEndian) {
	const entryName = `${capitalize(group.name)}Entry`;
	const nestedCode = group.groups.map((ng) => generateGroupEntryClass(ng, enumMap, setMap, compositeMap, isBigEndian)).join("");
	const entryCompositeFields = compositeFieldsOf(group.fields, compositeMap);
	const nestedPrealloc = generatePreallocFields(group.groups, entryName, "entry", entryCompositeFields);
	const ctor = isBigEndian ? [`  constructor(buffer: ArrayBufferLike, offset: number) { super(buffer, offset, false); }`, ``] : [];
	const wrapOverride = group.varData.length > 0 ? [
		`  override wrap(buffer: ArrayBufferLike, offset: number): this {`,
		`    super.wrap(buffer, offset);`,
		`    this.cursor = ${entryName}.BLOCK_LENGTH;`,
		`    return this;`,
		`  }`,
		``
	] : [];
	const lastNestedGroupName = group.groups.length > 0 ? group.groups[group.groups.length - 1].name : null;
	const fieldDecoderLines = group.fields.map((f) => makeFieldAccessor(f, enumMap, setMap, compositeMap, isBigEndian));
	const fieldEncoderLines = group.fields.map((f) => makeFieldMutator(f, enumMap, setMap, compositeMap, isBigEndian));
	const varDataDecoderLines = group.varData.map((vd, i) => lastNestedGroupName && i === 0 ? varDataDecoderAfterGroup(vd, `_${lastNestedGroupName}Iter`, isBigEndian) : varDataDecoder(vd, isBigEndian));
	const varDataEncoderLines = group.varData.map((vd, i) => lastNestedGroupName && i === 0 ? varDataEncoderAfterGroup(vd, `_${lastNestedGroupName}Writer`, isBigEndian) : varDataEncoder(vd, isBigEndian));
	const groupDecoderAccessors = generateGroupAccessors(group.groups, `this.offset + ${entryName}.BLOCK_LENGTH`, "decoder", isBigEndian);
	const groupEncoderAccessors = generateGroupAccessors(group.groups, `this.offset + ${entryName}.BLOCK_LENGTH`, "encoder", isBigEndian);
	const absoluteEndBody = generateAbsoluteEndBody(group, entryName, isBigEndian);
	return nestedCode + [
		`class ${entryName} extends MessageFlyweight {`,
		`  static readonly BLOCK_LENGTH = ${group.blockLength};`,
		``,
		...nestedPrealloc.length > 0 ? [...nestedPrealloc, ``] : [],
		...ctor,
		...wrapOverride,
		...fieldDecoderLines,
		...fieldEncoderLines.length > 0 ? [``, ...fieldEncoderLines] : [],
		...varDataDecoderLines.length > 0 ? [``, ...varDataDecoderLines] : [],
		...varDataEncoderLines.length > 0 ? [``, ...varDataEncoderLines] : [],
		...groupDecoderAccessors.length > 0 ? [``, ...groupDecoderAccessors] : [],
		...groupEncoderAccessors.length > 0 ? [``, ...groupEncoderAccessors] : [],
		``,
		`  absoluteEnd(): number {`,
		...absoluteEndBody,
		`  }`,
		`}`,
		``
	].join("\n");
}
function collectGroupTypeRefs(groups, enumMap, setMap, compositeMap, refs) {
	for (const g of groups) {
		for (const f of g.fields) if (enumMap.has(f.type)) refs.enums.add(capitalize(f.type));
		else if (setMap.has(f.type)) refs.sets.add(capitalize(f.type));
		else if (compositeMap.has(f.type)) refs.composites.add(capitalize(f.type));
		collectGroupTypeRefs(g.groups, enumMap, setMap, compositeMap, refs);
	}
}
//#endregion
//#region src/codegen/message.ts
function generateMessage(msg, schema, packageName) {
	const compositeMap = new Map(schema.composites.map((c) => [c.name, c]));
	const enumMap = new Map(schema.enums.map((e) => [e.name, e]));
	const setMap = new Map(schema.sets.map((s) => [s.name, s]));
	const grouped = Object.groupBy(msg.fields, (f) => {
		if (f.type in PRIMITIVE_READER) return "primitive";
		if (compositeMap.has(f.type)) return "composite";
		if (enumMap.has(f.type)) return "enum";
		if (setMap.has(f.type)) return "set";
		return "skip";
	});
	const refs = {
		enums: new Set((grouped.enum ?? []).map((f) => capitalize(f.type))),
		sets: new Set((grouped.set ?? []).map((f) => capitalize(f.type))),
		composites: new Set((grouped.composite ?? []).map((f) => capitalize(f.type)))
	};
	collectGroupTypeRefs(msg.groups, enumMap, setMap, compositeMap, refs);
	const hasGroups = msg.groups.length > 0;
	const typeImports = [
		...[...refs.composites].map((cn) => `import { ${cn}Decoder } from './${cn}.js';`),
		...[...refs.enums].map((en) => `import { ${en} } from './${en}.js';`),
		...[...refs.sets].map((sn) => `import { ${sn} } from './${sn}.js';`)
	];
	const isBigEndian = schema.byteOrder === "bigEndian";
	const ctor = isBigEndian ? [`  constructor(buffer: ArrayBufferLike, offset: number) { super(buffer, offset, false); }`, ``] : [];
	const hasVarData = msg.varData.length > 0;
	const lastGroupName = hasGroups ? msg.groups[msg.groups.length - 1].name : null;
	const decoderLines = msg.fields.map((f) => makeFieldAccessor(f, enumMap, setMap, compositeMap, isBigEndian));
	const encoderLines = msg.fields.map((f) => makeFieldMutator(f, enumMap, setMap, compositeMap, isBigEndian));
	const skipCount = grouped.skip?.length ?? 0;
	const skipNote = skipCount > 0 ? [`  // ${skipCount} unresolvable field(s) skipped`, ``] : [];
	const varDataDecoderLines = msg.varData.map((vd, i) => hasGroups && i === 0 ? varDataDecoderAfterGroup(vd, `_${lastGroupName}Iter`, isBigEndian) : varDataDecoder(vd, isBigEndian));
	const varDataEncoderLines = msg.varData.map((vd, i) => hasGroups && i === 0 ? varDataEncoderAfterGroup(vd, `_${lastGroupName}Writer`, isBigEndian) : varDataEncoder(vd, isBigEndian));
	const decoderWrap = hasVarData ? [
		`  override wrap(buffer: ArrayBufferLike, offset: number): this {`,
		`    super.wrap(buffer, offset);`,
		`    this.cursor = ${msg.name}Decoder.BLOCK_LENGTH;`,
		`    return this;`,
		`  }`,
		``
	] : [];
	const encoderWrap = hasVarData ? [
		`  override wrap(buffer: ArrayBufferLike, offset: number): this {`,
		`    super.wrap(buffer, offset);`,
		`    this.cursor = ${msg.name}Encoder.BLOCK_LENGTH;`,
		`    return this;`,
		`  }`,
		``
	] : [];
	const entryClassCode = msg.groups.map((g) => generateGroupEntryClass(g, enumMap, setMap, compositeMap, isBigEndian)).join("");
	const msgCompositeFields = compositeFieldsOf(msg.fields, compositeMap);
	const decoderPreallocFields = generatePreallocFields(msg.groups, `${msg.name}Decoder`, "decoder", msgCompositeFields);
	const encoderPreallocFields = generatePreallocFields(msg.groups, `${msg.name}Encoder`, "encoder");
	const decoderGroupAccessors = generateGroupAccessors(msg.groups, `this.offset + ${msg.name}Decoder.BLOCK_LENGTH`, "decoder", isBigEndian);
	const encoderGroupAccessors = generateGroupAccessors(msg.groups, `this.offset + ${msg.name}Encoder.BLOCK_LENGTH`, "encoder", isBigEndian);
	const runtimeImports = hasGroups ? [`import { MessageFlyweight, GroupIterator, GroupWriter } from 'sbe-ts';`] : [`import { MessageFlyweight } from 'sbe-ts';`];
	return [
		`// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.`,
		`// Package: ${packageName || schema.package}  Schema ID: ${schema.id}  Version: ${schema.version}`,
		...runtimeImports,
		...typeImports,
		``,
		...entryClassCode ? [entryClassCode] : [],
		`export class ${msg.name}Decoder extends MessageFlyweight {`,
		`  static readonly BLOCK_LENGTH = ${msg.blockLength};`,
		`  static readonly TEMPLATE_ID  = ${msg.id};`,
		`  static readonly SCHEMA_ID    = ${schema.id};`,
		`  static readonly VERSION      = ${schema.version};`,
		``,
		...ctor,
		...decoderPreallocFields.length > 0 ? [...decoderPreallocFields, ``] : [],
		...decoderWrap,
		...skipNote,
		...decoderLines,
		...decoderGroupAccessors.length > 0 ? [``, ...decoderGroupAccessors] : [],
		...varDataDecoderLines.length > 0 ? [``, ...varDataDecoderLines] : [],
		`}`,
		``,
		`export class ${msg.name}Encoder extends MessageFlyweight {`,
		`  static readonly BLOCK_LENGTH = ${msg.blockLength};`,
		``,
		...ctor,
		...encoderPreallocFields.length > 0 ? [...encoderPreallocFields, ``] : [],
		...encoderWrap,
		...encoderLines,
		...encoderGroupAccessors.length > 0 ? [``, ...encoderGroupAccessors] : [],
		...varDataEncoderLines.length > 0 ? [``, ...varDataEncoderLines] : [],
		`}`,
		``
	].join("\n");
}
function generateAll(schema, packageName) {
	return schema.messages.map((msg) => ({
		name: `${msg.name}.ts`,
		content: generateMessage(msg, schema, packageName)
	}));
}
//#endregion
export { generateAll };

//# sourceMappingURL=message-Cz3QroVP.mjs.map