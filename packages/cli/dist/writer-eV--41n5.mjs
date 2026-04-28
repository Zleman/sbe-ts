#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
//#region src/codegen/writer.ts
function writeFiles(files, outputDir) {
	mkdirSync(outputDir, { recursive: true });
	for (const file of files) writeFileSync(join(outputDir, file.name), file.content, "utf-8");
}
//#endregion
export { writeFiles };

//# sourceMappingURL=writer-eV--41n5.mjs.map