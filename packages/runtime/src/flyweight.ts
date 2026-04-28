export class MessageFlyweight {
  protected view: DataView;
  protected offset: number;
  protected readonly littleEndian: boolean;
  protected cursor = 0;

  constructor(buffer: ArrayBufferLike, offset: number, littleEndian = true) {
    this.view = new DataView(buffer);
    this.offset = offset;
    this.littleEndian = littleEndian;
  }

  wrap(buffer: ArrayBufferLike, offset: number): this {
    if (this.view.buffer !== buffer) {
      this.view = new DataView(buffer);
    }
    this.offset = offset;
    this.cursor = 0;
    return this;
  }

  wrapOffset(offset: number): this {
    this.offset = offset;
    return this;
  }

  getInt8(fieldOffset: number): number {
    return this.view.getInt8(this.offset + fieldOffset);
  }

  setInt8(fieldOffset: number, value: number): this {
    this.view.setInt8(this.offset + fieldOffset, value);
    return this;
  }

  getUint8(fieldOffset: number): number {
    return this.view.getUint8(this.offset + fieldOffset);
  }

  setUint8(fieldOffset: number, value: number): this {
    this.view.setUint8(this.offset + fieldOffset, value);
    return this;
  }

  getInt16(fieldOffset: number): number {
    return this.view.getInt16(this.offset + fieldOffset, this.littleEndian);
  }

  setInt16(fieldOffset: number, value: number): this {
    this.view.setInt16(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getUint16(fieldOffset: number): number {
    return this.view.getUint16(this.offset + fieldOffset, this.littleEndian);
  }

  setUint16(fieldOffset: number, value: number): this {
    this.view.setUint16(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getInt32(fieldOffset: number): number {
    return this.view.getInt32(this.offset + fieldOffset, this.littleEndian);
  }

  setInt32(fieldOffset: number, value: number): this {
    this.view.setInt32(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getUint32(fieldOffset: number): number {
    return this.view.getUint32(this.offset + fieldOffset, this.littleEndian);
  }

  setUint32(fieldOffset: number, value: number): this {
    this.view.setUint32(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getInt64(fieldOffset: number): bigint {
    return this.view.getBigInt64(this.offset + fieldOffset, this.littleEndian);
  }

  setInt64(fieldOffset: number, value: bigint): this {
    this.view.setBigInt64(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getUint64(fieldOffset: number): bigint {
    return this.view.getBigUint64(this.offset + fieldOffset, this.littleEndian);
  }

  setUint64(fieldOffset: number, value: bigint): this {
    this.view.setBigUint64(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getFloat32(fieldOffset: number): number {
    return this.view.getFloat32(this.offset + fieldOffset, this.littleEndian);
  }

  setFloat32(fieldOffset: number, value: number): this {
    this.view.setFloat32(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getFloat64(fieldOffset: number): number {
    return this.view.getFloat64(this.offset + fieldOffset, this.littleEndian);
  }

  setFloat64(fieldOffset: number, value: number): this {
    this.view.setFloat64(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  getFloat16(fieldOffset: number): number {
    return this.view.getFloat16(this.offset + fieldOffset, this.littleEndian);
  }

  setFloat16(fieldOffset: number, value: number): this {
    this.view.setFloat16(this.offset + fieldOffset, value, this.littleEndian);
    return this;
  }

  [Symbol.dispose](): void {
    this.offset = -1;
  }

  getBuffer(): ArrayBufferLike {
    return this.view.buffer;
  }

  getOffset(): number {
    return this.offset;
  }
}
