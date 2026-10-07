/**
 * Znaczniki drzew na mapie pełnoekranowej. Lasy z kafli MVT są pocięte na granicach kafli (z zakładką),
 * więc zamiast sklejać wielokąty rasteryzujemy je do siatki (reguła `nonzero` – zakładki i kawałki
 * jednego lasu z sąsiednich kafli zlewają się same, dziury i woda wypadają) i liczymy, jak głęboko
 * w lesie leży każda komórka. Znacznik trafia tylko tam, gdzie mieści się w całości w lesie,
 * najpierw w najgłębsze miejsca (środki płatów), w odstępach co najmniej `spacingPx` na ekranie.
 * Czyste funkcje – współrzędne w pikselach świata (Web Mercator, poziom mapy okolicy).
 */
import type { XY } from './areaMapProjection';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ForestGrid {
  /** Lewy górny róg siatki (piksele świata). */
  x0: number;
  y0: number;
  /** Bok komórki (piksele świata). */
  cell: number;
  cols: number;
  rows: number;
  /**
   * Głębokość komórki w lesie: odległość jej środka od środka najbliższej komórki poza lasem
   * (w komórkach, metryka chamfer 1/√2); 0 = poza lasem. Poza siatką = poza lasem.
   */
  depth: Float32Array;
}

/** Komórki siatki, których środek leży w środku pierścieni (reguła `nonzero`) → 1. */
export function rasterizeRings(
  rings: ArrayLike<number>[],
  grid: Pick<ForestGrid, 'x0' | 'y0' | 'cell' | 'cols' | 'rows'>,
): Uint8Array {
  const { x0, y0, cell, cols, rows } = grid;
  const out = new Uint8Array(cols * rows);
  // Przecięcia krawędzi z poziomą linią przez środki komórek wiersza: [x, kierunek, x, kierunek, …].
  const hits: number[][] = Array.from({ length: rows }, () => []);
  for (const r of rings) {
    const n = r.length;
    if (n < 6) continue;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ax = r[j];
      const ay = r[j + 1];
      const bx = r[i];
      const by = r[i + 1];
      if (ay === by) continue;
      const dir = by > ay ? 1 : -1;
      const lo = ay < by ? ay : by;
      const hi = ay < by ? by : ay;
      // Wiersze o środku yc w [lo, hi) – półotwarty przedział, wierzchołek liczy się raz.
      const r0 = Math.max(0, Math.ceil((lo - y0) / cell - 0.5));
      const r1 = Math.min(rows - 1, Math.ceil((hi - y0) / cell - 0.5) - 1);
      for (let row = r0; row <= r1; row++) {
        const yc = y0 + (row + 0.5) * cell;
        hits[row].push(ax + ((yc - ay) * (bx - ax)) / (by - ay), dir);
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    const h = hits[row];
    const m = h.length / 2;
    if (!m) continue;
    const order = Array.from({ length: m }, (_, k) => k).sort((a, b) => h[2 * a] - h[2 * b]);
    let wn = 0;
    let start = 0;
    for (const k of order) {
      const x = h[2 * k];
      const prev = wn;
      wn += h[2 * k + 1];
      if (prev === 0 && wn !== 0) start = x;
      else if (prev !== 0 && wn === 0) {
        // Kolumny o środku xc w [start, x).
        const c0 = Math.max(0, Math.ceil((start - x0) / cell - 0.5));
        const c1 = Math.min(cols - 1, Math.ceil((x - x0) / cell - 0.5) - 1);
        for (let c = c0; c <= c1; c++) out[row * cols + c] = 1;
      }
    }
  }
  return out;
}

/** Transformata odległości (chamfer 1/√2, dwa przejścia): 0 dla komórek poza maską i poza siatką. */
function chamfer(mask: Uint8Array, cols: number, rows: number): Float32Array {
  const D = Math.SQRT2;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? Infinity : 0;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : d[r * cols + c]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(c - 1, r) + 1, at(c, r - 1) + 1, at(c - 1, r - 1) + D, at(c + 1, r - 1) + D);
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(c + 1, r) + 1, at(c, r + 1) + 1, at(c + 1, r + 1) + D, at(c - 1, r + 1) + D);
    }
  }
  return d;
}

/**
 * Siatka głębokości lasu w obszarze `bounds`. `exclude` (np. woda) wycina komórki – jezioro w lesie
 * nie dostanie drzewka.
 */
export function buildForestGrid(
  forest: ArrayLike<number>[],
  opts: { bounds: Bounds; cell: number; exclude?: ArrayLike<number>[] },
): ForestGrid {
  const { bounds, cell } = opts;
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cell));
  const base = { x0: bounds.minX, y0: bounds.minY, cell, cols, rows };
  const mask = rasterizeRings(forest, base);
  if (opts.exclude?.length) {
    const ex = rasterizeRings(opts.exclude, base);
    for (let i = 0; i < mask.length; i++) if (ex[i]) mask[i] = 0;
  }
  return { ...base, depth: chamfer(mask, cols, rows) };
}

export interface TreeMarker extends XY {
  /** Odległość od brzegu lasu (piksele świata, w przybliżeniu). */
  depth: number;
}

export interface TreeMarkerOptions {
  /** Minimalny odstęp znaczników na ekranie (px). */
  spacingPx: number;
  /** Minimalna odległość znacznika od brzegu lasu na ekranie (px) – znacznik mieści się w lesie. */
  minDepthPx: number;
}

/**
 * Punkty znaczników drzew dla skali `pxPerWorld` (px ekranu na piksel świata). Wynik zależy tylko
 * od siatki i skali (nie od przesunięcia kadru), więc przy przesuwaniu mapy znaczniki nie skaczą.
 */
export function pickTreeMarkers(grid: ForestGrid, pxPerWorld: number, opts: TreeMarkerOptions): TreeMarker[] {
  const { x0, y0, cell, cols, rows, depth } = grid;
  const cellPx = cell * pxPerWorld;
  if (!(cellPx > 0)) return [];
  // Brzeg lasu leży średnio pół komórki przed środkiem najbliższej komórki „poza lasem”.
  const minDepth = opts.minDepthPx / cellPx + 0.5;
  // 1) Kubełki ~pół odstępu (zakotwiczone w siatce, nie w kadrze): z każdego najgłębsza komórka.
  const bucket = opts.spacingPx / 2;
  const bCols = Math.ceil((cols * cellPx) / bucket) + 1;
  const best = new Map<number, number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const dv = depth[i];
      if (dv < minDepth) continue;
      const key = Math.floor(((r + 0.5) * cellPx) / bucket) * bCols + Math.floor(((c + 0.5) * cellPx) / bucket);
      const cur = best.get(key);
      if (cur === undefined || dv > depth[cur]) best.set(key, i);
    }
  }
  // 2) Najgłębsze najpierw; znacznik bliżej niż `spacingPx` od przyjętego odpada.
  const cand = [...best.values()].sort((a, b) => depth[b] - depth[a] || a - b);
  const sp = opts.spacingPx;
  const sp2 = sp * sp;
  const taken = new Map<number, XY[]>();
  const hCols = Math.ceil((cols * cellPx) / sp) + 1;
  const out: TreeMarker[] = [];
  for (const i of cand) {
    const c = i % cols;
    const r = (i - c) / cols;
    const sx = (c + 0.5) * cellPx;
    const sy = (r + 0.5) * cellPx;
    const hx = Math.floor(sx / sp);
    const hy = Math.floor(sy / sp);
    let free = true;
    for (let dy = -1; dy <= 1 && free; dy++) {
      for (let dx = -1; dx <= 1 && free; dx++) {
        for (const q of taken.get((hy + dy) * hCols + hx + dx) ?? []) {
          if ((q.x - sx) ** 2 + (q.y - sy) ** 2 < sp2) {
            free = false;
            break;
          }
        }
      }
    }
    if (!free) continue;
    const key = hy * hCols + hx;
    const list = taken.get(key);
    if (list) list.push({ x: sx, y: sy });
    else taken.set(key, [{ x: sx, y: sy }]);
    out.push({ x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell, depth: (depth[i] - 0.5) * cell });
  }
  return out;
}
