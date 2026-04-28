#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
//#region src/index.ts
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf-8"));
const USAGE = `
sbe-ts-cli v${pkg.version}

Usage:
  sbe-ts-cli generate --schema <path> --output <dir> [--package <name>]

Commands:
  generate    Compile an SBE XML schema to TypeScript decoder/encoder classes

Options:
  --schema    Path to the SBE XML schema file (required)
  --output    Output directory for generated TypeScript files (required)
  --package   Package name to embed in generated file headers
  --version   Print version
  --help      Print this message
`.trim();
const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		schema: { type: "string" },
		output: { type: "string" },
		package: { type: "string" },
		version: {
			type: "boolean",
			short: "v"
		},
		help: {
			type: "boolean",
			short: "h"
		}
	},
	allowPositionals: true,
	strict: true
});
if (values.version) {
	console.log(pkg.version);
	process.exit(0);
}
if (values.help || positionals.length === 0) {
	console.log(USAGE);
	process.exit(0);
}
const [command] = positionals;
if (command !== "generate") {
	console.error(`Unknown command: ${command}\n\n${USAGE}`);
	process.exit(1);
}
if (!values.schema || !values.output) {
	console.error("generate requires --schema and --output\n\n" + USAGE);
	process.exit(1);
}
const { parseSchema } = await import("./schema-C-MRhG8S.mjs");
const { generateAll } = await import("./message-Cz3QroVP.mjs");
const { generateComposites } = await import("./composite-9FvhQV5A.mjs");
const { generateEnums } = await import("./enum--5KlOHqX.mjs");
const { generateSets } = await import("./set-BubFrwcY.mjs");
const { writeFiles } = await import("./writer-eV--41n5.mjs");
const schema = parseSchema(values.schema);
const compositeFiles = generateComposites(schema);
const enumFiles = generateEnums(schema);
const setFiles = generateSets(schema);
const msgFiles = generateAll(schema, values.package ?? "");
const files = [
	...compositeFiles,
	...enumFiles,
	...setFiles,
	...msgFiles
];
await writeFiles(files, values.output);
console.log(`Generated ${files.length} file(s) → ${values.output}`);
//#endregion
export {};

//# sourceMappingURL=index.mjs.map