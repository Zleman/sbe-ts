import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8'),
) as { version: string };

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
    schema:  { type: 'string' },
    output:  { type: 'string' },
    package: { type: 'string' },
    version: { type: 'boolean', short: 'v' },
    help:    { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
  strict: true,
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

if (command !== 'generate') {
  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}

if (!values.schema || !values.output) {
  console.error('generate requires --schema and --output\n\n' + USAGE);
  process.exit(1);
}

const { parseSchema } = await import('./parser/schema.js');
const { generateAll } = await import('./codegen/message.js');
const { generateComposites } = await import('./codegen/composite.js');
const { generateEnums } = await import('./codegen/enum.js');
const { generateSets } = await import('./codegen/set.js');
const { writeFiles } = await import('./codegen/writer.js');

const schema = parseSchema(values.schema);
const compositeFiles = generateComposites(schema);
const enumFiles = generateEnums(schema);
const setFiles = generateSets(schema);
const msgFiles = generateAll(schema, values.package ?? '');
const files = [...compositeFiles, ...enumFiles, ...setFiles, ...msgFiles];
await writeFiles(files, values.output);

console.log(`Generated ${files.length} file(s) → ${values.output}`);
