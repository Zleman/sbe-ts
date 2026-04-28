#!/usr/bin/env node
//#region src/codegen/helpers.ts
const PRIMITIVE_READER = {
	int8: {
		method: "getInt8",
		tsType: "number"
	},
	uint8: {
		method: "getUint8",
		tsType: "number"
	},
	int16: {
		method: "getInt16",
		tsType: "number"
	},
	uint16: {
		method: "getUint16",
		tsType: "number"
	},
	int32: {
		method: "getInt32",
		tsType: "number"
	},
	uint32: {
		method: "getUint32",
		tsType: "number"
	},
	int64: {
		method: "getInt64",
		tsType: "bigint"
	},
	uint64: {
		method: "getUint64",
		tsType: "bigint"
	},
	float: {
		method: "getFloat32",
		tsType: "number"
	},
	double: {
		method: "getFloat64",
		tsType: "number"
	},
	float16: {
		method: "getFloat16",
		tsType: "number"
	},
	char: {
		method: "getUint8",
		tsType: "number"
	}
};
const PRIMITIVE_WRITER = {
	int8: {
		method: "setInt8",
		tsType: "number"
	},
	uint8: {
		method: "setUint8",
		tsType: "number"
	},
	int16: {
		method: "setInt16",
		tsType: "number"
	},
	uint16: {
		method: "setUint16",
		tsType: "number"
	},
	int32: {
		method: "setInt32",
		tsType: "number"
	},
	uint32: {
		method: "setUint32",
		tsType: "number"
	},
	int64: {
		method: "setInt64",
		tsType: "bigint"
	},
	uint64: {
		method: "setUint64",
		tsType: "bigint"
	},
	float: {
		method: "setFloat32",
		tsType: "number"
	},
	double: {
		method: "setFloat64",
		tsType: "number"
	},
	float16: {
		method: "setFloat16",
		tsType: "number"
	},
	char: {
		method: "setUint8",
		tsType: "number"
	}
};
function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
const NO_ENDIAN_TYPES = new Set([
	"int8",
	"uint8",
	"char"
]);
function toDirectMethod(flyweightMethod) {
	if (flyweightMethod === "getInt64") return "getBigInt64";
	if (flyweightMethod === "getUint64") return "getBigUint64";
	if (flyweightMethod === "setInt64") return "setBigInt64";
	if (flyweightMethod === "setUint64") return "setBigUint64";
	return flyweightMethod;
}
function endianArg(type, isBigEndian) {
	if (NO_ENDIAN_TYPES.has(type)) return "";
	return `, ${String(!isBigEndian)}`;
}
//#endregion
export { toDirectMethod as a, endianArg as i, PRIMITIVE_WRITER as n, capitalize as r, PRIMITIVE_READER as t };

//# sourceMappingURL=helpers-CO4clmJF.mjs.map