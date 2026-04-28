import type { SbeSchema, SbeEnum } from '../parser/types.js';
import type { GeneratedFile } from './message.js';
import { capitalize } from './helpers.js';

function generateEnum(e: SbeEnum): string {
  const entries = e.values.map((v) => `  ${v.name}: ${v.value},`).join('\n');
  const capName = capitalize(e.name);
  return [
    `// AUTO-GENERATED — do not edit. Re-run sbe-ts-cli to regenerate.`,
    `export const ${capName} = {`,
    entries,
    `} as const;`,
    `export type ${capName} = (typeof ${capName})[keyof typeof ${capName}];`,
    ``,
  ].join('\n');
}

export function generateEnums(schema: SbeSchema): GeneratedFile[] {
  return schema.enums.map((e) => ({
    name: `${capitalize(e.name)}.ts`,
    content: generateEnum(e),
  }));
}
