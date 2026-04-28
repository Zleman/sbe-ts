Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/flyweight.ts
var MessageFlyweight = class {
	view;
	offset;
	littleEndian;
	cursor = 0;
	constructor(buffer, offset, littleEndian = true) {
		this.view = new DataView(buffer);
		this.offset = offset;
		this.littleEndian = littleEndian;
	}
	wrap(buffer, offset) {
		if (this.view.buffer !== buffer) this.view = new DataView(buffer);
		this.offset = offset;
		this.cursor = 0;
		return this;
	}
	wrapOffset(offset) {
		this.offset = offset;
		return this;
	}
	getInt8(fieldOffset) {
		return this.view.getInt8(this.offset + fieldOffset);
	}
	setInt8(fieldOffset, value) {
		this.view.setInt8(this.offset + fieldOffset, value);
		return this;
	}
	getUint8(fieldOffset) {
		return this.view.getUint8(this.offset + fieldOffset);
	}
	setUint8(fieldOffset, value) {
		this.view.setUint8(this.offset + fieldOffset, value);
		return this;
	}
	getInt16(fieldOffset) {
		return this.view.getInt16(this.offset + fieldOffset, this.littleEndian);
	}
	setInt16(fieldOffset, value) {
		this.view.setInt16(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getUint16(fieldOffset) {
		return this.view.getUint16(this.offset + fieldOffset, this.littleEndian);
	}
	setUint16(fieldOffset, value) {
		this.view.setUint16(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getInt32(fieldOffset) {
		return this.view.getInt32(this.offset + fieldOffset, this.littleEndian);
	}
	setInt32(fieldOffset, value) {
		this.view.setInt32(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getUint32(fieldOffset) {
		return this.view.getUint32(this.offset + fieldOffset, this.littleEndian);
	}
	setUint32(fieldOffset, value) {
		this.view.setUint32(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getInt64(fieldOffset) {
		return this.view.getBigInt64(this.offset + fieldOffset, this.littleEndian);
	}
	setInt64(fieldOffset, value) {
		this.view.setBigInt64(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getUint64(fieldOffset) {
		return this.view.getBigUint64(this.offset + fieldOffset, this.littleEndian);
	}
	setUint64(fieldOffset, value) {
		this.view.setBigUint64(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getFloat32(fieldOffset) {
		return this.view.getFloat32(this.offset + fieldOffset, this.littleEndian);
	}
	setFloat32(fieldOffset, value) {
		this.view.setFloat32(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getFloat64(fieldOffset) {
		return this.view.getFloat64(this.offset + fieldOffset, this.littleEndian);
	}
	setFloat64(fieldOffset, value) {
		this.view.setFloat64(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	getFloat16(fieldOffset) {
		return this.view.getFloat16(this.offset + fieldOffset, this.littleEndian);
	}
	setFloat16(fieldOffset, value) {
		this.view.setFloat16(this.offset + fieldOffset, value, this.littleEndian);
		return this;
	}
	[Symbol.dispose]() {
		this.offset = -1;
	}
	getBuffer() {
		return this.view.buffer;
	}
	getOffset() {
		return this.offset;
	}
};
//#endregion
//#region src/composite.ts
const CompositeFlyweight = MessageFlyweight;
//#endregion
//#region src/primitives.ts
function encodeString(str, buf, offset, maxLen) {
	const view = new DataView(buf);
	const len = Math.min(str.length, maxLen);
	for (let i = 0; i < len; i++) view.setUint8(offset + i, str.charCodeAt(i) & 255);
	for (let i = len; i < maxLen; i++) view.setUint8(offset + i, 0);
}
function decodeString(buf, offset, maxLen) {
	const view = new DataView(buf);
	const chars = [];
	for (let i = 0; i < maxLen; i++) {
		const code = view.getUint8(offset + i);
		if (code === 0) break;
		chars.push(String.fromCharCode(code));
	}
	return chars.join("");
}
//#endregion
//#region src/group.ts
var GroupCursor = class {
	_entry;
	_buf;
	_pos = 0;
	_remaining = 0;
	_entryPending = false;
	constructor(entry) {
		this._entry = entry;
	}
	reset(buf, pos, numInGroup) {
		this._buf = buf;
		this._pos = pos;
		this._remaining = numInGroup;
		this._entryPending = false;
		return this;
	}
	_syncPrev() {
		if (this._entryPending) {
			this._pos = this._entry.absoluteEnd();
			this._entryPending = false;
		}
	}
};
var GroupWriter = class extends GroupCursor {
	next() {
		this._syncPrev();
		if (this._remaining <= 0) throw new RangeError("GroupWriter: all declared entries already written");
		this._entry.wrap(this._buf, this._pos);
		this._remaining--;
		this._entryPending = true;
		return this._entry;
	}
	absoluteEnd() {
		this._syncPrev();
		return this._pos;
	}
};
var GroupIterator = class extends GroupCursor {
	absoluteEnd() {
		this._syncPrev();
		while (this._remaining > 0) {
			this._entry.wrap(this._buf, this._pos);
			this._pos = this._entry.absoluteEnd();
			this._remaining--;
		}
		return this._pos;
	}
	[Symbol.iterator]() {
		return this;
	}
	next() {
		this._syncPrev();
		if (this._remaining <= 0) return {
			done: true,
			value: void 0
		};
		this._entry.wrap(this._buf, this._pos);
		this._remaining--;
		this._entryPending = true;
		return {
			done: false,
			value: this._entry
		};
	}
	return() {
		this.absoluteEnd();
		return {
			done: true,
			value: void 0
		};
	}
};
//#endregion
exports.CompositeFlyweight = CompositeFlyweight;
exports.GroupIterator = GroupIterator;
exports.GroupWriter = GroupWriter;
exports.MessageFlyweight = MessageFlyweight;
exports.decodeString = decodeString;
exports.encodeString = encodeString;

//# sourceMappingURL=index.cjs.map