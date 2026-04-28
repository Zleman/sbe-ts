#!/usr/bin/env node
import { r as capitalize } from "./helpers-CO4clmJF.mjs";
//#region src/codegen/enum.ts
function generateEnum(e) {
	const entries = e.values.map((v) => `  ${v.name}: ${v.value},`).join("\n");
	const capName = capitalize(e.name);
	return [
		`// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.`,
		`export const ${capName} = {`,
		entries,
		`} as const;`,
		`export type ${capName} = (typeof ${capName})[keyof typeof ${capName}];`,
		``
	].join("\n");
}
function generateEnums(schema) {
	return schema.enums.map((e) => ({
		name: `${capitalize(e.name)}.ts`,
		content: generateEnum(e)
	}));
}
//#endregion
export { generateEnums };

//# sourceMappingURL=enum--5KlOHqX.mjs.map