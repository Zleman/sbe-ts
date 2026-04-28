import type { SbeSchema, SbeSet } from '../parser/types.js';
import type { GeneratedFile } from './message.js';
import { capitalize } from './helpers.js';

function generateSet(s: SbeSet): string {
  const capName = capitalize(s.name);
  const isBig = s.encodingType === 'uint64' || s.encodingType === 'int64';
  const entries = s.choices
    .map((c) => isBig
      ? `  ${c.name}: 1n << ${c.bitIndex}n,`
      : `  ${c.name}: (1 << ${c.bitIndex}) >>> 0,`)
    .join('\n');
  const tsType = isBig ? 'bigint' : 'number';
  const notZero = isBig ? '!== 0n' : '!== 0';
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
    ``,
  ].join('\n');
}

export function generateSets(schema: SbeSchema): GeneratedFile[] {
  return schema.sets.map((s) => ({
    name: `${capitalize(s.name)}.ts`,
    content: generateSet(s),
  }));
}
