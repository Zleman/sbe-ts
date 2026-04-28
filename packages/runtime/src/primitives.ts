// ASCII / Latin-1 only — each character is truncated to one byte. Use TextEncoder for UTF-8.
export function encodeString(str: string, buf: ArrayBufferLike, offset: number, maxLen: number): void {
  const view = new DataView(buf);
  const len = Math.min(str.length, maxLen);
  for (let i = 0; i < len; i++) {
    view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
  }
  for (let i = len; i < maxLen; i++) {
    view.setUint8(offset + i, 0);
  }
}

// ASCII / Latin-1 only — reads one byte per character. Use TextDecoder for UTF-8.
export function decodeString(buf: ArrayBufferLike, offset: number, maxLen: number): string {
  const view = new DataView(buf);
  const chars: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
}
