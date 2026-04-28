#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
//#region src/parser/schema.ts
const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	processEntities: false,
	trimValues: true,
	isArray: (tagName) => [
		"sbe:message",
		"field",
		"composite",
		"type",
		"enum",
		"validValue",
		"set",
		"choice",
		"data",
		"group",
		"ref",
		"types"
	].includes(tagName)
});
const PRIMITIVE_BYTE_SIZE = {
	int8: 1,
	uint8: 1,
	char: 1,
	int16: 2,
	uint16: 2,
	float16: 2,
	int32: 4,
	uint32: 4,
	float: 4,
	int64: 8,
	uint64: 8,
	double: 8
};
function asArray(v) {
	if (Array.isArray(v)) return v;
	if (v != null) return [v];
	return [];
}
function getFieldByteSize(type, ctx) {
	if (type in PRIMITIVE_BYTE_SIZE) return PRIMITIVE_BYTE_SIZE[type];
	const alias = ctx.typeAliasMap.get(type);
	if (alias) return (PRIMITIVE_BYTE_SIZE[alias.primitiveType] ?? 1) * alias.length;
	const en = ctx.enumMap.get(type);
	if (en) return PRIMITIVE_BYTE_SIZE[en.encodingType] ?? 1;
	const st = ctx.setMap.get(type);
	if (st) return PRIMITIVE_BYTE_SIZE[st.encodingType] ?? 1;
	const comp = ctx.compositeMap.get(type);
	if (comp) return comp.fields.filter((f) => !f.isConstant).reduce((sum, f) => {
		return sum + (f.byteSize !== void 0 ? f.byteSize : getFieldByteSize(f.primitiveType, ctx) * (f.length ?? 1));
	}, 0);
	return 1;
}
function resolveFieldType(type, ctx) {
	const alias = ctx.typeAliasMap.get(type);
	if (alias && alias.length === 1) return alias.primitiveType;
	return type;
}
function parseGroupFields(rawFields, ctx) {
	let cursor = 0;
	return rawFields.map((f) => {
		const field = f;
		const name = field["@_name"] ?? "";
		const rawType = field["@_type"] ?? "";
		const id = Number(field["@_id"] ?? 0);
		const offset = field["@_offset"] !== void 0 ? Number(field["@_offset"]) : cursor;
		cursor = offset + getFieldByteSize(rawType, ctx);
		return {
			name,
			id,
			type: resolveFieldType(rawType, ctx),
			offset
		};
	});
}
function parseVarData(rawDataEls, ctx) {
	return rawDataEls.map((d) => {
		const el = d;
		const name = el["@_name"] ?? "";
		const id = Number(el["@_id"] ?? 0);
		const type = el["@_type"] ?? "";
		const lengthPrimitiveType = ctx.compositeMap.get(type)?.fields[0]?.primitiveType ?? "uint32";
		return {
			name,
			id,
			type,
			lengthPrimitiveType,
			lengthByteSize: PRIMITIVE_BYTE_SIZE[lengthPrimitiveType] ?? 4
		};
	});
}
function parseGroup(raw, ctx) {
	const name = raw["@_name"] ?? "";
	const id = Number(raw["@_id"] ?? 0);
	const dimensionType = raw["@_dimensionType"] ?? "groupSizeEncoding";
	const fields = parseGroupFields(asArray(raw["field"]), ctx);
	const blockLengthAttr = raw["@_blockLength"];
	const blockLength = blockLengthAttr !== void 0 ? Number(blockLengthAttr) : fields.reduce((max, f) => Math.max(max, f.offset + getFieldByteSize(f.type, ctx)), 0);
	const groups = asArray(raw["group"]).map((g) => parseGroup(g, ctx));
	const varData = parseVarData(asArray(raw["data"]), ctx);
	const dimComp = ctx.compositeMap.get(dimensionType);
	let numInGroupOffset = 2;
	let numInGroupPrimitive = "uint16";
	let headerSize = 4;
	if (dimComp) {
		let cur = 0;
		for (const f of dimComp.fields) {
			const fsz = f.byteSize !== void 0 ? f.byteSize : (PRIMITIVE_BYTE_SIZE[f.primitiveType] ?? 1) * (f.length ?? 1);
			if (f.name === "numInGroup") {
				numInGroupOffset = cur;
				numInGroupPrimitive = f.primitiveType;
			}
			cur += fsz;
		}
		headerSize = cur;
	}
	return {
		name,
		id,
		blockLength,
		dimensionType,
		numInGroupOffset,
		numInGroupPrimitive,
		headerSize,
		fields,
		groups,
		varData
	};
}
function parseSchema(filePath) {
	const xml = readFileSync(filePath, "utf-8").trim();
	const root = parser.parse(xml)["sbe:messageSchema"];
	if (!root) throw new Error(`No <sbe:messageSchema> root element found in ${filePath}`);
	const byteOrder = root["@_byteOrder"] === "bigEndian" ? "bigEndian" : "littleEndian";
	const composites = [];
	const enums = [];
	const sets = [];
	const typeAliasMap = /* @__PURE__ */ new Map();
	const typesBlocks = asArray(root["types"]);
	for (const rawBlock of typesBlocks) {
		const tb = rawBlock;
		for (const t of asArray(tb["type"])) {
			const ta = t;
			const aliasName = ta["@_name"];
			const primitiveType = ta["@_primitiveType"];
			if (!aliasName || !primitiveType) continue;
			const length = ta["@_length"] !== void 0 ? Number(ta["@_length"]) : 1;
			typeAliasMap.set(aliasName, {
				primitiveType,
				length
			});
		}
		for (const c of asArray(tb["composite"])) {
			const comp = c;
			const compName = comp["@_name"];
			if (!compName) continue;
			const allFields = [];
			for (const t of asArray(comp["type"])) {
				const f = t;
				const name = f["@_name"];
				const primitiveType = f["@_primitiveType"];
				if (!name || !primitiveType) continue;
				const isConstant = f["@_presence"] === "constant";
				const length = f["@_length"] !== void 0 ? Number(f["@_length"]) : 1;
				const sz = PRIMITIVE_BYTE_SIZE[primitiveType] ?? 1;
				allFields.push({
					name,
					primitiveType,
					length,
					byteSize: isConstant ? 0 : sz * length,
					isConstant
				});
			}
			for (const r of asArray(comp["ref"])) {
				const f = r;
				const name = f["@_name"];
				const refType = f["@_type"];
				if (!name || !refType) continue;
				allFields.push({
					name,
					primitiveType: refType,
					length: 1,
					byteSize: void 0,
					isConstant: false
				});
			}
			for (const e of asArray(comp["enum"])) {
				const f = e;
				const name = f["@_name"];
				const encodingType = f["@_encodingType"];
				if (!name || !encodingType) continue;
				const sz = PRIMITIVE_BYTE_SIZE[encodingType] ?? 1;
				allFields.push({
					name,
					primitiveType: encodingType,
					length: 1,
					byteSize: sz,
					isConstant: false
				});
			}
			composites.push({
				name: compName,
				fields: allFields
			});
		}
		for (const s of asArray(tb["set"])) {
			const st = s;
			sets.push({
				name: st["@_name"],
				encodingType: st["@_encodingType"],
				choices: asArray(st["choice"]).map((c) => {
					const ch = c;
					return {
						name: ch["@_name"],
						bitIndex: Number(ch["#text"])
					};
				})
			});
		}
		for (const e of asArray(tb["enum"])) {
			const en = e;
			enums.push({
				name: en["@_name"],
				encodingType: en["@_encodingType"],
				values: asArray(en["validValue"]).map((v) => {
					const val = v;
					const textVal = String(val["#text"] ?? "");
					const value = /^-?\d+$/.test(textVal.trim()) ? Number(textVal) : textVal.charCodeAt(0);
					return {
						name: val["@_name"],
						value
					};
				})
			});
		}
	}
	const ctx = {
		typeAliasMap,
		compositeMap: new Map(composites.map((c) => [c.name, c])),
		enumMap: new Map(enums.map((e) => [e.name, e])),
		setMap: new Map(sets.map((s) => [s.name, s]))
	};
	const messages = asArray(root["sbe:message"]).map((m, msgIdx) => {
		const msg = m;
		const msgName = msg["@_name"];
		if (!msgName) throw new Error(`Schema message at index ${msgIdx} is missing a "name" attribute in ${filePath}`);
		let msgFieldCursor = 0;
		const fields = asArray(msg["field"]).map((f, fieldIdx) => {
			const field = f;
			const name = field["@_name"];
			const rawType = field["@_type"];
			if (!name) throw new Error(`Message "${msgName}" field at index ${fieldIdx} is missing a "name" attribute in ${filePath}`);
			if (!rawType) throw new Error(`Message "${msgName}" field "${name}" is missing a "type" attribute in ${filePath}`);
			const offset = field["@_offset"] !== void 0 ? Number(field["@_offset"]) : msgFieldCursor;
			msgFieldCursor = offset + getFieldByteSize(rawType, ctx);
			return {
				name,
				id: Number(field["@_id"]),
				type: resolveFieldType(rawType, ctx),
				offset
			};
		});
		const groups = asArray(msg["group"]).map((g) => parseGroup(g, ctx));
		const varData = parseVarData(asArray(msg["data"]), ctx);
		const blockLengthAttr = msg["@_blockLength"];
		const blockLength = blockLengthAttr !== void 0 ? Number(blockLengthAttr) : fields.reduce((max, f) => Math.max(max, f.offset + getFieldByteSize(f.type, ctx)), 0);
		return {
			name: msgName,
			id: Number(msg["@_id"]),
			blockLength,
			fields,
			groups,
			varData
		};
	});
	return {
		package: root["@_package"] ?? "",
		id: Number(root["@_id"] ?? 0),
		version: Number(root["@_version"] ?? 0),
		byteOrder,
		messages,
		composites,
		enums,
		sets
	};
}
//#endregion
export { parseSchema };

//# sourceMappingURL=schema-C-MRhG8S.mjs.map