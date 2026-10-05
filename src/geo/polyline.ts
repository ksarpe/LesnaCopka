/**
 * Kodowanie „Google polyline” (precyzja 1e-5°, ok. 1 m) dla pierścieni zapisanych płasko:
 * [lon0, lat0, lon1, lat1, …]. Delty całkowite → ASCII 63–126, więc granice gmin mieszczą się
 * w zwykłych plikach JSON kilkukrotnie mniejszych niż GeoJSON.
 */
const FACTOR = 1e5;

function encodeNum(v: number) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (n >= 0x20) {
    s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>>= 5;
  }
  return s + String.fromCharCode(n + 63);
}

/** Koduje pierścień; pomija punkty, które po zaokrągleniu się powtarzają, i punkt zamykający. */
export function encodeRing(flat: ArrayLike<number>): string {
  let out = '';
  let px = 0;
  let py = 0;
  let count = 0;
  let n = flat.length;
  if (n >= 4 && flat[0] === flat[n - 2] && flat[1] === flat[n - 1]) n -= 2;
  for (let i = 0; i < n; i += 2) {
    const x = Math.round(flat[i] * FACTOR);
    const y = Math.round(flat[i + 1] * FACTOR);
    if (count > 0 && x === px && y === py) continue;
    out += encodeNum(x - px) + encodeNum(y - py);
    px = x;
    py = y;
    count++;
  }
  return out;
}

export function decodeRing(s: string): number[] {
  const out: number[] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  while (i < s.length) {
    let r = 0;
    let shift = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    x += r & 1 ? ~(r >> 1) : r >> 1;
    r = 0;
    shift = 0;
    do {
      b = s.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    y += r & 1 ? ~(r >> 1) : r >> 1;
    out.push(x / FACTOR, y / FACTOR);
  }
  return out;
}
