import { describe, expect, it } from '@jest/globals';

import { base64ToBytes, bytesToBase64, dataUriBytes, exactBuffer } from '../bytes';

describe('base64 i data URI (zdjęcia z weba do Storage)', () => {
  it('kodowanie w obie strony zgodne z Buffer (wszystkie długości reszty)', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
    }
  });

  it('data URI JPEG-a → bajty; bez base64 → null', () => {
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9];
    const uri = `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`;
    expect(Array.from(dataUriBytes(uri) ?? [])).toEqual(jpeg);
    expect(dataUriBytes('data:text/plain,hello')).toBeNull();
    expect(dataUriBytes('file:///a.jpg')).toBeNull();
  });

  it('ArrayBuffer dokładnie z zakresu widoku', () => {
    const all = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(Array.from(new Uint8Array(exactBuffer(all.subarray(1, 4))))).toEqual([2, 3, 4]);
    expect(exactBuffer(all)).toBe(all.buffer);
  });
});
