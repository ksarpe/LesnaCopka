/**
 * Geometria płaska na pierścieniach zapisanych płasko [x0, y0, x1, y1, …] (bez punktu zamykającego).
 * Te same funkcje działają na stopniach (granice gmin) i na pikselach Web Mercator (mapa okolicy).
 */

/** Pierścień albo linia: [x0, y0, x1, y1, …]. */
export type Flat = ArrayLike<number>;
/** Wielokąt: pierwszy pierścień zewnętrzny, kolejne to dziury. */
export type Polygon = Flat[];

export const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQ = 111_320;
const RAD = Math.PI / 180;

export function metersPerDegLon(lat: number) {
  return M_PER_DEG_LON_EQ * Math.cos(lat * RAD);
}

/** Ray casting – parzystość przecięć. */
export function pointInRing(x: number, y: number, r: Flat): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i];
    const yi = r[i + 1];
    const xj = r[j];
    const yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, y: number, poly: Polygon): boolean {
  if (!poly.length || !pointInRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(x, y, poly[k])) return false;
  return true;
}

export function pointInMultiPolygon(x: number, y: number, polys: Polygon[]): boolean {
  for (const p of polys) if (pointInPolygon(x, y, p)) return true;
  return false;
}

/**
 * Kwadrat odległości punktu (x, y) od pierścienia/linii po przeskalowaniu osi przez (kx, ky).
 * `closed` = pierścień (dochodzi odcinek ostatni → pierwszy).
 */
export function distance2ToPath(x: number, y: number, r: Flat, closed: boolean, kx = 1, ky = 1): number {
  const n = r.length;
  if (n < 2) return Infinity;
  if (n === 2) {
    const dx = (r[0] - x) * kx;
    const dy = (r[1] - y) * ky;
    return dx * dx + dy * dy;
  }
  let best = Infinity;
  let i = closed ? 0 : 2;
  let j = closed ? n - 2 : 0;
  for (; i < n; j = i, i += 2) {
    const ax = (r[j] - x) * kx;
    const ay = (r[j + 1] - y) * ky;
    const dx = (r[i] - x) * kx - ax;
    const dy = (r[i + 1] - y) * ky - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d2 = px * px + py * py;
    if (d2 < best) best = d2;
  }
  return best;
}

/** Odległość (m) punktu od najbliższej krawędzi wielokątów zapisanych w stopniach. */
export function distanceToBoundaryM(lon: number, lat: number, polys: Polygon[]): number {
  const kx = metersPerDegLon(lat);
  let best = Infinity;
  for (const p of polys) for (const r of p) best = Math.min(best, distance2ToPath(lon, lat, r, true, kx, M_PER_DEG_LAT));
  return Math.sqrt(best);
}

/**
 * Liczba nawinięć pierścienia wokół punktu (ze znakiem). Suma po wielu pierścieniach ≠ 0 ⇔ punkt
 * w środku przy regule `nonzero` – nakładające się wielokąty (np. z sąsiednich kafli) się sumują,
 * a dziury (przeciwny kierunek) odejmują.
 */
export function windingNumber(x: number, y: number, r: Flat): number {
  let wn = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const x1 = r[j];
    const y1 = r[j + 1];
    const x2 = r[i];
    const y2 = r[i + 1];
    const side = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
    if (y1 <= y) {
      if (y2 > y && side > 0) wn++;
    } else if (y2 <= y && side < 0) wn--;
  }
  return wn;
}

/**
 * Odległość punktu od zbioru wielokątów zapisanych jako pierścienie z kierunkiem (reguła `nonzero`):
 * 0, gdy punkt jest w środku; Infinity, gdy zbiór jest pusty.
 */
export function distanceToFilledRings(x: number, y: number, rings: Flat[]): number {
  return nearestPointOnFilledRings(x, y, rings)?.d ?? Infinity;
}

export interface NearestPoint {
  x: number;
  y: number;
  /** Odległość od punktu wejściowego (0 w środku). */
  d: number;
  /** Punkt wejściowy leży w środku (reguła `nonzero`) – wtedy (x, y) to on sam. */
  inside: boolean;
}

/**
 * Najbliższy punkt brzegu zbioru wielokątów (pierścienie z kierunkiem, reguła `nonzero`); null, gdy zbiór pusty.
 * Wielokąty przycięte do kafli mają „szwy” na granicach kafli, ale szew leży w środku sumy wielokątów
 * (kafle zachodzą na siebie), więc z zewnątrz najbliższy zawsze jest prawdziwy brzeg.
 */
export function nearestPointOnFilledRings(x: number, y: number, rings: Flat[]): NearestPoint | null {
  let wn = 0;
  for (const r of rings) wn += windingNumber(x, y, r);
  if (wn !== 0) return { x, y, d: 0, inside: true };
  let best = Infinity;
  let bx = NaN;
  let by = NaN;
  for (const r of rings) {
    const n = r.length;
    if (n < 2) continue;
    // Pojedynczy punkt = zdegenerowany pierścień (odcinek długości 0).
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ax = r[j];
      const ay = r[j + 1];
      const dx = r[i] - ax;
      const dy = r[i + 1] - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d2 = (px - x) * (px - x) + (py - y) * (py - y);
      if (d2 < best) {
        best = d2;
        bx = px;
        by = py;
      }
    }
  }
  return best === Infinity ? null : { x: bx, y: by, d: Math.sqrt(best), inside: false };
}
