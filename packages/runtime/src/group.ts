export interface GroupEntry {
  wrap(buffer: ArrayBufferLike, offset: number): unknown;
  absoluteEnd(): number;
}

abstract class GroupCursor<T extends GroupEntry> {
  protected readonly _entry: T;
  protected _buf!: ArrayBufferLike;
  protected _pos = 0;
  protected _remaining = 0;
  protected _entryPending = false;

  constructor(entry: T) { this._entry = entry; }

  reset(buf: ArrayBufferLike, pos: number, numInGroup: number): this {
    this._buf = buf;
    this._pos = pos;
    this._remaining = numInGroup;
    this._entryPending = false;
    return this;
  }

  protected _syncPrev(): void {
    if (this._entryPending) {
      this._pos = this._entry.absoluteEnd();
      this._entryPending = false;
    }
  }
}

export class GroupWriter<T extends GroupEntry> extends GroupCursor<T> {
  next(): T {
    this._syncPrev();
    if (this._remaining <= 0) throw new RangeError('GroupWriter: all declared entries already written');
    this._entry.wrap(this._buf, this._pos);
    this._remaining--;
    this._entryPending = true;
    return this._entry;
  }

  absoluteEnd(): number {
    this._syncPrev();
    return this._pos;
  }
}

export class GroupIterator<T extends GroupEntry> extends GroupCursor<T> {
  absoluteEnd(): number {
    this._syncPrev();
    while (this._remaining > 0) {
      this._entry.wrap(this._buf, this._pos);
      this._pos = this._entry.absoluteEnd();
      this._remaining--;
    }
    return this._pos;
  }

  [Symbol.iterator](): this { return this; }

  next(): IteratorResult<T> {
    this._syncPrev();
    if (this._remaining <= 0) return { done: true, value: undefined as unknown as T };
    this._entry.wrap(this._buf, this._pos);
    this._remaining--;
    this._entryPending = true;
    return { done: false, value: this._entry };
  }

  return(): IteratorResult<T> {
    this.absoluteEnd();
    return { done: true, value: undefined as unknown as T };
  }
}
