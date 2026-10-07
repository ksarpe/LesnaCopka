/**
 * Bajty i base64 – czyste funkcje (Hermes, przeglądarka i node bez atob/btoa): data URI zdjęć na webie
 * i bajty do wysyłki w Supabase Storage (src/services/supabase/storage.ts).
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** base64 → bajty (bez atob – działa tak samo w Hermes, przeglądarce i node). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_INDEX[clean[i]] ?? 0;
    const b = B64_INDEX[clean[i + 1]] ?? 0;
    const c = B64_INDEX[clean[i + 2]];
    const d = B64_INDEX[clean[i + 3]];
    out[o++] = (a << 2) | (b >> 4);
    if (c !== undefined && o < out.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d !== undefined && o < out.length) out[o++] = ((c! & 3) << 6) | d;
  }
  return o === out.length ? out : out.slice(0, o);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const rest = bytes.length - i;
    const n = (bytes[i] << 16) | (rest > 1 ? bytes[i + 1] << 8 : 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (rest > 1 ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return s;
}

/** `data:image/jpeg;base64,…` → bajty; inny zapis (bez base64) → null. */
export function dataUriBytes(uri: string): Uint8Array | null {
  const m = /^data:([^;,]*)(;[^,]*)?,([\s\S]*)$/.exec(uri);
  if (!m || !(m[2] ?? '').includes('base64')) return null;
  return base64ToBytes(m[3]);
}

/** ArrayBuffer dokładnie z zakresu widoku (supabase-js w RN zaleca ArrayBuffer zamiast Blob). */
export function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
