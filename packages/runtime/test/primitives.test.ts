import { describe, it, expect } from 'vitest';
import { encodeString, decodeString } from '../src/primitives.js';

describe('encodeString / decodeString', () => {
  it('roundtrips an ASCII string', () => {
    const buf = new ArrayBuffer(16);
    encodeString('hello', buf, 0, 16);
    expect(decodeString(buf, 0, 16)).toBe('hello');
  });

  it('truncates to maxLen', () => {
    const buf = new ArrayBuffer(4);
    encodeString('abcdefgh', buf, 0, 4);
    expect(decodeString(buf, 0, 4)).toBe('abcd');
  });

  it('stops at null byte on decode', () => {
    const buf = new ArrayBuffer(8);
    encodeString('hi', buf, 0, 8);
    expect(decodeString(buf, 0, 8)).toBe('hi');
  });

  it('writes at a non-zero buffer offset', () => {
    const buf = new ArrayBuffer(16);
    encodeString('ok', buf, 8, 4);
    expect(decodeString(buf, 0, 4)).toBe('');
    expect(decodeString(buf, 8, 4)).toBe('ok');
  });

  it('handles empty string', () => {
    const buf = new ArrayBuffer(4);
    encodeString('', buf, 0, 4);
    expect(decodeString(buf, 0, 4)).toBe('');
  });
});
