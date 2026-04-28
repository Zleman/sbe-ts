#!/usr/bin/env node
import { r as capitalize } from "./helpers-CO4clmJF.mjs";
//#region src/codegen/set.ts
function generateSet(s) {
	const capName = capitalize(s.name);
	const isBig = s.encodingType === "uint64" || s.encodingType === "int64";
	const entries = s.choices.map((c) => isBig ? `  ${c.name}: 1n << ${c.bitIndex}n,` : `  ${c.name}: (1 << ${c.bitIndex}) >>> 0,`).join("\n");
	const tsType = isBig ? "bigint" : "number";
	const notZero = isBig ? "!== 0n" : "!== 0";
	return [
		`// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.`,
		`export const ${capName} = {`,
		entries,
		`} as const;`,
		`export type ${capName} = ${tsType};`,
		``,
		`export function hasFlag(value: ${capName}, flag: ${tsType}): boolean {`,
		`  return (value & flag) ${notZero};`,
		`}`,
		``
	].join("\n");
}
function generateSets(schema) {
	return schema.sets.map((s) => ({
		name: `${capitalize(s.name)}.ts`,
		content: generateSet(s)
	}));
}
//#endregion
export { generateSets };

//# sourceMappingURL=set-BubFrwcY.mjs.map