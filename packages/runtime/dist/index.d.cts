//#region src/flyweight.d.ts
declare class MessageFlyweight {
  protected view: DataView;
  protected offset: number;
  protected readonly littleEndian: boolean;
  protected cursor: number;
  constructor(buffer: ArrayBufferLike, offset: number, littleEndian?: boolean);
  wrap(buffer: ArrayBufferLike, offset: number): this;
  wrapOffset(offset: number): this;
  getInt8(fieldOffset: number): number;
  setInt8(fieldOffset: number, value: number): this;
  getUint8(fieldOffset: number): number;
  setUint8(fieldOffset: number, value: number): this;
  getInt16(fieldOffset: number): number;
  setInt16(fieldOffset: number, value: number): this;
  getUint16(fieldOffset: number): number;
  setUint16(fieldOffset: number, value: number): this;
  getInt32(fieldOffset: number): number;
  setInt32(fieldOffset: number, value: number): this;
  getUint32(fieldOffset: number): number;
  setUint32(fieldOffset: number, value: number): this;
  getInt64(fieldOffset: number): bigint;
  setInt64(fieldOffset: number, value: bigint): this;
  getUint64(fieldOffset: number): bigint;
  setUint64(fieldOffset: number, value: bigint): this;
  getFloat32(fieldOffset: number): number;
  setFloat32(fieldOffset: number, value: number): this;
  getFloat64(fieldOffset: number): number;
  setFloat64(fieldOffset: number, value: number): this;
  getFloat16(fieldOffset: number): number;
  setFloat16(fieldOffset: number, value: number): this;
  [Symbol.dispose](): void;
  getBuffer(): ArrayBufferLike;
  getOffset(): number;
}
//#endregion
//#region src/composite.d.ts
declare const CompositeFlyweight: typeof MessageFlyweight;
type CompositeFlyweight = InstanceType<typeof MessageFlyweight>;
//#endregion
//#region src/primitives.d.ts
declare function encodeString(str: string, buf: ArrayBufferLike, offset: number, maxLen: number): void;
declare function decodeString(buf: ArrayBufferLike, offset: number, maxLen: number): string;
//#endregion
//#region src/group.d.ts
interface GroupEntry {
  wrap(buffer: ArrayBufferLike, offset: number): unknown;
  absoluteEnd(): number;
}
declare abstract class GroupCursor<T extends GroupEntry> {
  protected readonly _entry: T;
  protected _buf!: ArrayBufferLike;
  protected _pos: number;
  protected _remaining: number;
  protected _entryPending: boolean;
  constructor(entry: T);
  reset(buf: ArrayBufferLike, pos: number, numInGroup: number): this;
  protected _syncPrev(): void;
}
declare class GroupWriter<T extends GroupEntry> extends GroupCursor<T> {
  next(): T;
  absoluteEnd(): number;
}
declare class GroupIterator<T extends GroupEntry> extends GroupCursor<T> {
  absoluteEnd(): number;
  [Symbol.iterator](): this;
  next(): IteratorResult<T>;
  return(): IteratorResult<T>;
}
//#endregion
export { CompositeFlyweight, type GroupEntry, GroupIterator, GroupWriter, MessageFlyweight, decodeString, encodeString };
//# sourceMappingURL=index.d.cts.map