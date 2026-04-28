import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parseSchema } from '../src/parser/schema.js';
import { generateAll } from '../src/codegen/message.js';
import { generateComposites } from '../src/codegen/composite.js';
import { generateEnums } from '../src/codegen/enum.js';
import { generateSets } from '../src/codegen/set.js';
import type { SbeSchema } from '../src/parser/types.js';

const fixtures = join(fileURLToPath(import.meta.url), '..', 'fixtures');
const fix = (name: string) => join(fixtures, name);

function runTsgo(files: { name: string; content: string }[], tmpPrefix: string): void {
  const tmp = mkdtempSync(join(tmpdir(), tmpPrefix));
  try {
    for (const file of files) {
      writeFileSync(join(tmp, file.name), file.content);
    }
    const runtimeSrc = resolve(
      fileURLToPath(import.meta.url),
      '..', '..', '..', 'runtime', 'src', 'index.ts',
    );
    const tsconfig = {
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        noEmit: true,
        allowImportingTsExtensions: true,
        lib: ['ES2025', 'ESNext.Disposable'],
        paths: { 'sbe-ts': [runtimeSrc] },
      },
      include: ['*.ts'],
    };
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify(tsconfig));
    const isWin = process.platform === 'win32';
    const tsgo = resolve(
      fileURLToPath(import.meta.url),
      '..', '..', '..', '..', 'node_modules', '.bin',
      isWin ? 'tsgo.cmd' : 'tsgo',
    );
    const tsconfigPath = join(tmp, 'tsconfig.json');
    const [bin, ...spawnArgs] = isWin
      ? ['cmd', '/c', tsgo, '--noEmit', '--project', tsconfigPath]
      : [tsgo, '--noEmit', '--project', tsconfigPath];
    const result = spawnSync(bin!, spawnArgs, { encoding: 'utf-8' });
    if (result.status !== 0) {
      console.error('tsgo stdout:', result.stdout);
      console.error('tsgo stderr:', result.stderr);
    }
    expect(result.status).toBe(0);
  } finally {
    rmSync(tmp, { recursive: true });
  }
}

describe('generateAll — snapshots', () => {
  it('market-data.xml MarketData', () => {
    const [md] = generateAll(parseSchema(fix('market-data.xml')), '');
    expect(md!.content).toMatchSnapshot();
  });

  it('market-data.xml OrderAck', () => {
    const [_md, ack] = generateAll(parseSchema(fix('market-data.xml')), '');
    expect(ack!.content).toMatchSnapshot();
  });

  it('big-endian.xml SimpleOrder', () => {
    const [msg] = generateAll(parseSchema(fix('big-endian.xml')), '');
    expect(msg!.content).toMatchSnapshot();
  });

  it('all-types.xml AllTypes', () => {
    const [msg] = generateAll(parseSchema(fix('all-types.xml')), '');
    expect(msg!.content).toMatchSnapshot();
  });
});

describe('generateAll — unknown-type resilience', () => {
  it('does not throw on real-logic schema with non-primitive types', () => {
    expect(() => generateAll(parseSchema(fix('real-logic-example.xml')), '')).not.toThrow();
  });

  it('generated Car file contains CarDecoder and CarEncoder', () => {
    const [car] = generateAll(parseSchema(fix('real-logic-example.xml')), '');
    expect(car!.content).toContain('class CarDecoder');
    expect(car!.content).toContain('class CarEncoder');
  });

  it('array-typed fields emit a skipped comment, not a method', () => {
    const [car] = generateAll(parseSchema(fix('real-logic-example.xml')), '');
    expect(car!.content).toContain('// skipped: vehicleCode');
    expect(car!.content).not.toContain('vehicleCode(): ');
  });

  it('produces one output file per message', () => {
    const files = generateAll(parseSchema(fix('real-logic-example.xml')), '');
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('Car.ts');
  });
});

describe('generateAll — decode correctness', () => {
  it('MarketData decoder methods use correct DataView calls and offsets', () => {
    const [md] = generateAll(parseSchema(fix('market-data.xml')), '');
    const src = md!.content;
    expect(src).toContain('instrumentId(): number { return this.view.getUint32(this.offset + 0, true); }');
    expect(src).toContain('price(): bigint { return this.view.getBigInt64(this.offset + 4, true); }');
    expect(src).toContain('quantity(): bigint { return this.view.getBigInt64(this.offset + 12, true); }');
    expect(src).toContain('flags(): number { return this.view.getUint32(this.offset + 20, true); }');
  });

  it('MarketData encoder methods use correct DataView calls and offsets', () => {
    const [md] = generateAll(parseSchema(fix('market-data.xml')), '');
    const src = md!.content;
    expect(src).toContain('setInstrumentId(v: number): this { this.view.setUint32(this.offset + 0, v, true); return this; }');
    expect(src).toContain('setPrice(v: bigint): this { this.view.setBigInt64(this.offset + 4, v, true); return this; }');
    expect(src).toContain('setQuantity(v: bigint): this { this.view.setBigInt64(this.offset + 12, v, true); return this; }');
    expect(src).toContain('setFlags(v: number): this { this.view.setUint32(this.offset + 20, v, true); return this; }');
  });

  it('all-types float16 field maps to getFloat16 / setFloat16', () => {
    const [msg] = generateAll(parseSchema(fix('all-types.xml')), '');
    const src = msg!.content;
    expect(src).toContain('f_float16(): number { return this.view.getFloat16(this.offset + 42, true); }');
    expect(src).toContain('setF_float16(v: number): this { this.view.setFloat16(this.offset + 42, v, true); return this; }');
  });
});

describe('generateAll — endianness baking', () => {
  it('big-endian schema generates constructor with false', () => {
    const [msg] = generateAll(parseSchema(fix('big-endian.xml')), '');
    expect(msg!.content).toContain('super(buffer, offset, false)');
  });

  it('little-endian schema does not emit a constructor override', () => {
    const [msg] = generateAll(parseSchema(fix('market-data.xml')), '');
    expect(msg!.content).not.toContain('super(buffer, offset,');
  });
});

describe('generateComposites — basics', () => {
  it('produces one file named MessageHeader.ts from market-data.xml', () => {
    const files = generateComposites(parseSchema(fix('market-data.xml')));
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('MessageHeader.ts');
  });

  it('MessageHeader.ts matches snapshot', () => {
    const [file] = generateComposites(parseSchema(fix('market-data.xml')));
    expect(file!.content).toMatchSnapshot();
  });

  it('infers offsets: blockLength=0, templateId=2, schemaId=4, version=6', () => {
    const [file] = generateComposites(parseSchema(fix('market-data.xml')));
    const src = file!.content;
    expect(src).toContain('blockLength(): number { return this.view.getUint16(this.offset + 0, true); }');
    expect(src).toContain('templateId(): number { return this.view.getUint16(this.offset + 2, true); }');
    expect(src).toContain('schemaId(): number { return this.view.getUint16(this.offset + 4, true); }');
    expect(src).toContain('version(): number { return this.view.getUint16(this.offset + 6, true); }');
  });

  it('SIZE constant equals 8', () => {
    const [file] = generateComposites(parseSchema(fix('market-data.xml')));
    expect(file!.content).toContain('static readonly SIZE = 8');
  });

  it('extends CompositeFlyweight not MessageFlyweight', () => {
    const [file] = generateComposites(parseSchema(fix('market-data.xml')));
    expect(file!.content).toContain('extends CompositeFlyweight');
    expect(file!.content).not.toContain('extends MessageFlyweight');
  });

  it('little-endian composite has no constructor override', () => {
    const [file] = generateComposites(parseSchema(fix('market-data.xml')));
    expect(file!.content).not.toContain('super(buffer, offset,');
  });

  it('big-endian composite generates constructor with false', () => {
    const schema: SbeSchema = {
      package: 'test', id: 1, version: 0, byteOrder: 'bigEndian', messages: [],
      composites: [{ name: 'header', fields: [{ name: 'id', primitiveType: 'uint16' }] }],
      enums: [],
      sets: [],
    };
    const [file] = generateComposites(schema);
    expect(file!.content).toContain('super(buffer, offset, false)');
  });

  it('unknown primitiveType emits a skipped comment, does not throw', () => {
    const schema: SbeSchema = {
      package: 'test', id: 1, version: 0, byteOrder: 'littleEndian', messages: [],
      composites: [{ name: 'bad', fields: [{ name: 'x', primitiveType: 'unknown123' }] }],
      enums: [],
      sets: [],
    };
    expect(() => generateComposites(schema)).not.toThrow();
    const [file] = generateComposites(schema);
    expect(file!.content).toContain("// skipped: x (type 'unknown123'");
  });

  it('returns empty array when schema has no composites', () => {
    expect(generateComposites(parseSchema(fix('no-composites.xml')))).toEqual([]);
  });
});

describe('generateComposites + generateAll — composite-field.xml', () => {
  it('Span.ts matches snapshot', () => {
    const [span] = generateComposites(parseSchema(fix('composite-field.xml')));
    expect(span!.content).toMatchSnapshot();
  });

  it('PriceRange.ts imports SpanDecoder', () => {
    const [msg] = generateAll(parseSchema(fix('composite-field.xml')), '');
    expect(msg!.content).toContain("import { SpanDecoder } from './Span.js'");
  });

  it('PriceRange.ts range() returns pre-allocated SpanDecoder at offset 4', () => {
    const [msg] = generateAll(parseSchema(fix('composite-field.xml')), '');
    expect(msg!.content).toContain(
      'range(): SpanDecoder { return this._range.wrap(this.view.buffer, this.offset + 4); }',
    );
    expect(msg!.content).toContain('private readonly _range = new SpanDecoder(PriceRangeDecoder._EMPTY, 0)');
  });

  it('PriceRange.ts encoder skips range with composite comment', () => {
    const [msg] = generateAll(parseSchema(fix('composite-field.xml')), '');
    expect(msg!.content).toContain('// skipped: range (composite — use SpanEncoder directly)');
  });
});

describe('generateEnums — basics', () => {
  it('produces one file per enum', () => {
    const files = generateEnums(parseSchema(fix('enum-field.xml')));
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.name)).toContain('Side.ts');
    expect(files.map((f) => f.name)).toContain('TimeInForce.ts');
  });

  it('Side.ts contains as const object with Buy and Sell', () => {
    const files = generateEnums(parseSchema(fix('enum-field.xml')));
    const side = files.find((f) => f.name === 'Side.ts')!.content;
    expect(side).toContain('Buy: 0');
    expect(side).toContain('Sell: 1');
    expect(side).toContain('} as const');
    expect(side).toContain('export type Side');
  });

  it('TimeInForce.ts preserves non-contiguous value 3', () => {
    const files = generateEnums(parseSchema(fix('enum-field.xml')));
    const tif = files.find((f) => f.name === 'TimeInForce.ts')!.content;
    expect(tif).toContain('ImmediateOrCancel: 3');
  });

  it('returns empty array when schema has no enums', () => {
    expect(generateEnums(parseSchema(fix('market-data.xml')))).toEqual([]);
  });
});

describe('generateAll — enum-typed fields', () => {
  it('side field emits typed accessor returning Side', () => {
    const [msg] = generateAll(parseSchema(fix('enum-field.xml')), '');
    expect(msg!.content).toContain("side(): Side { return this.view.getUint8(this.offset + 8) as Side; }");
  });

  it('enum field encoder emits typed setter', () => {
    const [msg] = generateAll(parseSchema(fix('enum-field.xml')), '');
    expect(msg!.content).toContain("setSide(v: Side): this { this.view.setUint8(this.offset + 8, v); return this; }");
  });

  it('generated file imports the enum type', () => {
    const [msg] = generateAll(parseSchema(fix('enum-field.xml')), '');
    expect(msg!.content).toContain("import { Side } from './Side.js'");
    expect(msg!.content).toContain("import { TimeInForce } from './TimeInForce.js'");
  });

  it('char-encoded enum field emits getUint8 accessor on Car', () => {
    const [car] = generateAll(parseSchema(fix('real-logic-example.xml')), '');
    expect(car!.content).toMatch(/getUint8\(this\.offset \+ \d+\) as Model/);
  });
});

describe('generateSets — basics', () => {
  it('produces one file per set', () => {
    const files = generateSets(parseSchema(fix('set-field.xml')));
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('OrderFlags.ts');
  });

  it('OrderFlags.ts contains as const with unsigned bit masks', () => {
    const [file] = generateSets(parseSchema(fix('set-field.xml')));
    const src = file!.content;
    expect(src).toContain('IsMarket: (1 << 0) >>> 0');
    expect(src).toContain('IsCross: (1 << 1) >>> 0');
    expect(src).toContain('IsBlock: (1 << 3) >>> 0');
    expect(src).toContain('} as const');
  });

  it('OrderFlags.ts exports hasFlag helper', () => {
    const [file] = generateSets(parseSchema(fix('set-field.xml')));
    expect(file!.content).toContain('export function hasFlag');
  });

  it('returns empty array when schema has no sets', () => {
    expect(generateSets(parseSchema(fix('market-data.xml')))).toEqual([]);
  });

  it('number set uses (1 << n) >>> 0 unsigned mask form', () => {
    const [file] = generateSets(parseSchema(fix('set-field.xml')));
    expect(file!.content).toContain('(1 << 0) >>> 0');
    expect(file!.content).toContain('(1 << 3) >>> 0');
  });
});

describe('generateAll — set-typed fields', () => {
  it('orderFlags field emits typed accessor returning OrderFlags', () => {
    const [msg] = generateAll(parseSchema(fix('set-field.xml')), '');
    expect(msg!.content).toContain("orderFlags(): OrderFlags { return this.view.getUint8(this.offset + 8) as OrderFlags; }");
  });

  it('set field encoder emits typed setter', () => {
    const [msg] = generateAll(parseSchema(fix('set-field.xml')), '');
    expect(msg!.content).toContain("setOrderFlags(v: OrderFlags): this { this.view.setUint8(this.offset + 8, v); return this; }");
  });

  it('generated file imports the set type', () => {
    const [msg] = generateAll(parseSchema(fix('set-field.xml')), '');
    expect(msg!.content).toContain("import { OrderFlags } from './OrderFlags.js'");
  });
});

describe('generateAll — varData fields', () => {
  it('generates wrap() override setting cursor to BLOCK_LENGTH', () => {
    const [msg] = generateAll(parseSchema(fix('var-data.xml')), '');
    expect(msg!.content).toContain('override wrap(buffer: ArrayBufferLike, offset: number): this');
    expect(msg!.content).toContain('this.cursor = TextMessageDecoder.BLOCK_LENGTH');
  });

  it('decoder emits Uint8Array accessor reading length prefix then data', () => {
    const [msg] = generateAll(parseSchema(fix('var-data.xml')), '');
    const src = msg!.content;
    expect(src).toContain('text(): Uint8Array');
    expect(src).toContain('this.view.getUint32(pos, true)');
    expect(src).toContain('this.cursor += 4 + len');
  });

  it('encoder emits setter that writes length prefix then copies data', () => {
    const [msg] = generateAll(parseSchema(fix('var-data.xml')), '');
    const src = msg!.content;
    expect(src).toContain('setText(data: Uint8Array): this');
    expect(src).toContain('this.view.setUint32(pos, data.length, true)');
    expect(src).toContain('new Uint8Array(this.view.buffer, pos + 4, data.length).set(data)');
  });

  it('two sequential varData fields both appear in output', () => {
    const [msg] = generateAll(parseSchema(fix('var-data.xml')), '');
    const src = msg!.content;
    expect(src).toContain('text(): Uint8Array');
    expect(src).toContain('description(): Uint8Array');
  });

  it('little-endian schemas without varData do not emit wrap() override', () => {
    const [msg] = generateAll(parseSchema(fix('market-data.xml')), '');
    expect(msg!.content).not.toContain('override wrap');
  });
});

describe('generateAll — groups', () => {
  it('Trade.ts snapshot', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    expect(trade!.content).toMatchSnapshot();
  });

  it('imports GroupIterator and GroupWriter from sbe-ts when message has groups', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    expect(trade!.content).toContain("import { MessageFlyweight, GroupIterator, GroupWriter } from 'sbe-ts'");
  });

  it('emits leaf entry class LegsEntry before FillsEntry', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    expect(src).toContain('class LegsEntry extends MessageFlyweight');
    const legsIdx = src.indexOf('class LegsEntry');
    const fillsIdx = src.indexOf('class FillsEntry');
    expect(legsIdx).toBeLessThan(fillsIdx);
  });

  it('LegsEntry has BLOCK_LENGTH=4 and simple absoluteEnd()', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    expect(src).toContain('static readonly BLOCK_LENGTH = 4');
    expect(src).toContain('return this.offset + LegsEntry.BLOCK_LENGTH');
  });

  it('FillsEntry pre-allocates _legsEntry and _legsIter', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    expect(src).toContain('new LegsEntry(FillsEntry._EMPTY, 0)');
    expect(src).toContain('new GroupIterator(this._legsEntry)');
  });

  it('FillsEntry absoluteEnd() delegates to _legsIter.reset(...).absoluteEnd()', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    expect(trade!.content).toContain('_legsIter.reset(this.view.buffer, hdr0 + 4, n0).absoluteEnd()');
  });

  it('TradeDecoder pre-allocates _fillsEntry and _fillsIter', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    expect(src).toContain('new FillsEntry(TradeDecoder._EMPTY, 0)');
    expect(src).toContain('new GroupIterator(this._fillsEntry)');
  });

  it('TradeDecoder fills() accessor reads numInGroup from header', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    expect(src).toContain('fills(): GroupIterator<FillsEntry>');
    expect(src).toContain('return this._fillsIter.reset(view.buffer, hdrOff + 4, numInGroup)');
  });

  it('first VarData after group uses _fillsIter.absoluteEnd()', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    expect(src).toContain('comment(): Uint8Array');
    expect(src).toContain('const pos = this._fillsIter.absoluteEnd()');
    expect(src).toContain('this.cursor = (pos + 4 + len) - this.offset');
  });

  it('second VarData uses cursor-based access', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    expect(src).toContain('metadata(): Uint8Array');
    expect(src).toContain('const pos = this.offset + this.cursor');
    expect(src).toContain('this.cursor += 4 + len');
  });

  it('TradeEncoder has _fillsWriter pre-allocated (not _fillsIter)', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    const encoderIdx = src.indexOf('class TradeEncoder');
    expect(encoderIdx).toBeGreaterThan(-1);
    const encoderSection = src.slice(encoderIdx);
    expect(encoderSection).toContain('new FillsEntry(TradeEncoder._EMPTY, 0)');
    expect(encoderSection).toContain('new GroupWriter(this._fillsEntry)');
    expect(encoderSection).not.toContain('new GroupIterator(this._fillsEntry)');
  });

  it('TradeEncoder has fillsCount() returning GroupWriter<FillsEntry>', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    const encoderIdx = src.indexOf('class TradeEncoder');
    const encoderSection = src.slice(encoderIdx);
    expect(encoderSection).toContain('fillsCount(numInGroup: number): GroupWriter<FillsEntry>');
    expect(encoderSection).toContain('view.setUint16(hdrOff, FillsEntry.BLOCK_LENGTH');
    expect(encoderSection).toContain('return this._fillsWriter.reset(view.buffer, hdrOff + 4, numInGroup)');
  });

  it('encoder setComment uses _fillsWriter.absoluteEnd()', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    const encoderIdx = src.indexOf('class TradeEncoder');
    const encoderSection = src.slice(encoderIdx);
    expect(encoderSection).toContain('const pos = this._fillsWriter.absoluteEnd()');
  });

  it('FillsEntry has named setters for primitive fields', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    const fillsIdx = src.indexOf('class FillsEntry');
    const fillsSection = src.slice(fillsIdx, src.indexOf('\nclass ', fillsIdx + 1));
    expect(fillsSection).toContain('setPrice(');
    expect(fillsSection).toContain('setQuantity(');
  });

  it('FillsEntry has legsCount() returning GroupWriter<LegsEntry>', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    const src = trade!.content;
    const fillsIdx = src.indexOf('class FillsEntry');
    const fillsSection = src.slice(fillsIdx, src.indexOf('\nclass TradeDecoder'));
    expect(fillsSection).toContain('legsCount(numInGroup: number): GroupWriter<LegsEntry>');
    expect(fillsSection).toContain('return this._legsWriter.reset(view.buffer, hdrOff + 4, numInGroup)');
  });

});

describe('generateAll — integration: tsgo --noEmit', () => {
  it('generated MarketData.ts passes tsgo --noEmit', () => {
    const [md] = generateAll(parseSchema(fix('market-data.xml')), '');
    runTsgo([{ name: 'MarketData.ts', content: md!.content }], 'sbe-ts-int-');
  });

  it('Trade.ts (groups + nested groups + VarData) passes tsgo --noEmit', () => {
    const [trade] = generateAll(parseSchema(fix('groups.xml')), '');
    runTsgo([{ name: 'Trade.ts', content: trade!.content }], 'sbe-ts-grp-');
  });

  it('Span.ts + PriceRange.ts both pass tsgo --noEmit', () => {
    const schema = parseSchema(fix('composite-field.xml'));
    const [span] = generateComposites(schema);
    const [priceRange] = generateAll(schema, '');
    runTsgo([
      { name: 'Span.ts', content: span!.content },
      { name: 'PriceRange.ts', content: priceRange!.content },
    ], 'sbe-ts-comp-');
  });
});
