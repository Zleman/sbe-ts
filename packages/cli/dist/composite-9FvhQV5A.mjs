#!/usr/bin/env node
import { a as toDirectMethod, i as endianArg, n as PRIMITIVE_WRITER, r as capitalize, t as PRIMITIVE_READER } from "./helpers-CO4clmJF.mjs";
//#region src/codegen/composite.ts
const PRIMITIVE_BYTE_SIZE = {
	int8: 1,
	uint8: 1,
	int16: 2,
	uint16: 2,
	float16: 2,
	int32: 4,
	uint32: 4,
	float: 4,
	int64: 8,
	uint64: 8,
	double: 8,
	char: 1
};
function inferOffsets(fields) {
	let cursor = 0;
	return fields.filter((f) => !f.isConstant).map((f) => {
		const size = f.byteSize !== void 0 ? f.byteSize : (PRIMITIVE_BYTE_SIZE[f.primitiveType] ?? 0) * (f.length ?? 1);
		const offset = cursor;
		cursor += size;
		return {
			...f,
			offset
		};
	});
}
function computeSize(fields) {
	return fields.filter((f) => !f.isConstant).reduce((sum, f) => {
		return sum + (f.byteSize !== void 0 ? f.byteSize : (PRIMITIVE_BYTE_SIZE[f.primitiveType] ?? 0) * (f.length ?? 1));
	}, 0);
}
function generateComposite(composite, schema) {
	const className = capitalize(composite.name);
	const fieldsWithOffsets = inferOffsets(composite.fields);
	const size = computeSize(composite.fields);
	const isBigEndian = schema.byteOrder === "bigEndian";
	const ctor = isBigEndian ? [`  constructor(buffer: ArrayBufferLike, offset: number) { super(buffer, offset, false); }`, ``] : [];
	const decoderLines = fieldsWithOffsets.map((f) => {
		const r = PRIMITIVE_READER[f.primitiveType];
		if (!r || (f.length ?? 1) > 1) return `  // skipped: ${f.name} (type '${f.primitiveType}'${(f.length ?? 1) > 1 ? `, length ${f.length}` : ""} — not directly readable)`;
		const method = toDirectMethod(r.method);
		const ea = endianArg(f.primitiveType, isBigEndian);
		return `  ${f.name}(): ${r.tsType} { return this.view.${method}(this.offset + ${f.offset}${ea}); }`;
	});
	const encoderLines = fieldsWithOffsets.map((f) => {
		const w = PRIMITIVE_WRITER[f.primitiveType];
		if (!w || (f.length ?? 1) > 1) return `  // skipped: ${f.name} (type '${f.primitiveType}'${(f.length ?? 1) > 1 ? `, length ${f.length}` : ""} — not directly writable)`;
		const method = toDirectMethod(w.method);
		const ea = endianArg(f.primitiveType, isBigEndian);
		return `  set${capitalize(f.name)}(v: ${w.tsType}): this { this.view.${method}(this.offset + ${f.offset}, v${ea}); return this; }`;
	});
	return [
		`// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.`,
		`import { CompositeFlyweight } from 'sbe-ts';`,
		``,
		`export class ${className}Decoder extends CompositeFlyweight {`,
		`  static readonly SIZE = ${size};`,
		``,
		...ctor,
		...decoderLines,
		`}`,
		``,
		`export class ${className}Encoder extends CompositeFlyweight {`,
		...ctor,
		...encoderLines,
		`}`,
		``
	].join("\n");
}
function generateComposites(schema) {
	return schema.composites.map((c) => ({
		name: `${capitalize(c.name)}.ts`,
		content: generateComposite(c, schema)
	}));
}
//#endregion
export { generateComposites };

//# sourceMappingURL=composite-9FvhQV5A.mjs.map