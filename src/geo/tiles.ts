/**
 * Kafle mapy (Web Mercator, schemat z/x/y) – czyste funkcje dla map offline: zakres kafli wokół punktu,
 * dla prostokąta i gminy, szacunek rozmiaru, różnica obszarów przy usuwaniu i wybór kafli do usunięcia
 * z pamięci podręcznej (LRU). Bez I/O – zapis na dysku: src/services/live/tileStore.ts.
 */
import type { GminaKind } from '@/types';

import { pointInMultiPolygon, type Polygon } from './geometry';
import { lonLatToWorld, metersPerPx, TILE_SIZE } from './mercator';

/** Poziom kafli mapy okolicy (src/services/live/map.ts): ok. 3 km na boku w Polsce. */
export const TILE_ZOOM = 13;

/**
 * Średni rozmiar kafla z13 (MVT po rozpakowaniu) do szacunków przed pobraniem. Pomiar OpenFreeMap (2026-10):
 * lasy i wsie 9–12 KB, miasteczka 15–30 KB, Białystok ~50 KB, Warszawa ~90 KB – 25 KB to bezpieczny zapas
 * dla okolic poza dużym miastem.
 */
export const AVG_TILE_BYTES = 25_000;
/** Gmina miejska (gęsta zabudowa, dużo dróg) – kafle kilka razy większe. */
export const URBAN_TILE_BYTES = 70_000;

/** Zakres kafli (włącznie) na poziomie `z`. */
export interface TileRange {
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Prostokąt w stopniach: [zachód, południe, wschód, północ]. */
export type Bbox = [number, number, number, number];

/** Klucz kafla „13/4663/2687” – także ścieżka pliku (`tiles/13/4663/2687.pbf`). */
export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

export function parseTileKey(key: string): { z: number; x: number; y: number } | null {
  const m = /^(\d{1,2})\/(\d+)\/(\d+)$/.exec(key);
  if (!m) return null;
  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  const n = 2 ** z;
  return x < n && y < n ? { z, x, y } : null;
}

const clampTile = (v: number, z: number) => Math.max(0, Math.min(2 ** z - 1, v));

/**
 * Kafle kwadratu ±`radiusPx` wokół punktu świata (piksele na poziomie `z`) – ten sam zakres, który
 * pobiera mapa okolicy (src/services/live/map.ts).
 */
export function tileRangeAroundWorld(cx: number, cy: number, radiusPx: number, z = TILE_ZOOM): TileRange {
  return {
    z,
    x0: clampTile(Math.floor((cx - radiusPx) / TILE_SIZE), z),
    x1: clampTile(Math.floor((cx + radiusPx) / TILE_SIZE), z),
    y0: clampTile(Math.floor((cy - radiusPx) / TILE_SIZE), z),
    y1: clampTile(Math.floor((cy + radiusPx) / TILE_SIZE), z),
  };
}

/** Kafle kwadratu ±`radiusM` metrów wokół punktu (lat, lon). */
export function tileRangeForRadius(lat: number, lon: number, radiusM: number, z = TILE_ZOOM): TileRange {
  const c = lonLatToWorld(lon, lat, z);
  return tileRangeAroundWorld(c.x, c.y, radiusM / metersPerPx(lat, z), z);
}

/** Kafle prostokąta [W, S, E, N] (stopnie). */
export function tileRangeForBbox(bbox: Bbox, z = TILE_ZOOM): TileRange {
  const nw = lonLatToWorld(bbox[0], bbox[3], z);
  const se = lonLatToWorld(bbox[2], bbox[1], z);
  return {
    z,
    x0: clampTile(Math.floor(nw.x / TILE_SIZE), z),
    x1: clampTile(Math.floor(se.x / TILE_SIZE), z),
    y0: clampTile(Math.floor(nw.y / TILE_SIZE), z),
    y1: clampTile(Math.floor(se.y / TILE_SIZE), z),
  };
}

export function rangeCount(r: TileRange): number {
  return Math.max(0, r.x1 - r.x0 + 1) * Math.max(0, r.y1 - r.y0 + 1);
}

/** Klucze kafli zakresu (wierszami: y, potem x). */
export function rangeKeys(r: TileRange): string[] {
  const out: string[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push(tileKey(r.z, x, y));
  return out;
}

/** Granice kafla w stopniach [W, S, E, N]. */
export function tileBbox(x: number, y: number, z: number): Bbox {
  const n = 2 ** z;
  const lon = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

/** Prostokąt obejmujący kafle (stopnie) – zapisany przy obszarze offline zamiast dokładnej pozycji. */
export function keysBbox(keys: readonly string[]): Bbox | null {
  let out: Bbox | null = null;
  for (const k of keys) {
    const t = parseTileKey(k);
    if (!t) continue;
    const b = tileBbox(t.x, t.y, t.z);
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : b;
  }
  return out;
}

/** Czy odcinek (ax,ay)–(bx,by) przecina prostokąt [x0,x1]×[y0,y1] (Liang–Barsky). */
export function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/**
 * Kafle, które dotykają wielokątów (stopnie, [lon, lat]) – np. cała gmina z PRG. Z prostokąta gminy zostają
 * tylko kafle z kawałkiem gminy: z wierzchołkiem lub krawędzią granicy w środku albo w całości wewnątrz.
 * Przy gminach o nieregularnym kształcie to zwykle 20–40% kafli mniej niż sam prostokąt.
 */
export function tilesForPolygons(polys: Polygon[], z = TILE_ZOOM): string[] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const poly of polys)
    for (const ring of poly)
      for (let i = 0; i < ring.length; i += 2) {
        w = Math.min(w, ring[i]);
        e = Math.max(e, ring[i]);
        s = Math.min(s, ring[i + 1]);
        n = Math.max(n, ring[i + 1]);
      }
  if (!Number.isFinite(w)) return [];
  const range = tileRangeForBbox([w, s, e, n], z);
  const cols = range.x1 - range.x0 + 1;
  const hit = new Uint8Array(rangeCount(range));
  const idx = (x: number, y: number) => (y - range.y0) * cols + (x - range.x0);
  // Współrzędne kafli w „ułamkach kafla” – odcinek granicy przecina kafel ⇔ przecina jego kwadrat.
  const scale = 2 ** z;
  const tx = (lon: number) => ((lon + 180) / 360) * scale;
  const ty = (lat: number) => lonLatToWorld(0, lat, z).y / TILE_SIZE;

  for (const poly of polys)
    for (const ring of poly) {
      const m = ring.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = tx(ring[2 * i]);
        const ay = ty(ring[2 * i + 1]);
        const bx = tx(ring[2 * j]);
        const by = ty(ring[2 * j + 1]);
        const cx0 = Math.max(range.x0, Math.floor(Math.min(ax, bx)));
        const cx1 = Math.min(range.x1, Math.floor(Math.max(ax, bx)));
        const cy0 = Math.max(range.y0, Math.floor(Math.min(ay, by)));
        const cy1 = Math.min(range.y1, Math.floor(Math.max(ay, by)));
        for (let y = cy0; y <= cy1; y++)
          for (let x = cx0; x <= cx1; x++) {
            const k = idx(x, y);
            if (hit[k]) continue;
            // Odcinek w obrębie jednego kafla (typowe przy granicy uproszczonej do 15 m) – bez testu przecięcia.
            if ((cx0 === cx1 && cy0 === cy1) || segmentIntersectsRect(ax, ay, bx, by, x, y, x + 1, y + 1)) hit[k] = 1;
          }
      }
    }

  const out: string[] = [];
  for (let y = range.y0; y <= range.y1; y++)
    for (let x = range.x0; x <= range.x1; x++) {
      let inside = hit[idx(x, y)] === 1;
      if (!inside) {
        // Kafel bez granicy: albo cały w gminie, albo cały poza nią – wystarczy środek.
        const b = tileBbox(x, y, z);
        inside = pointInMultiPolygon((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, polys);
      }
      if (inside) out.push(tileKey(z, x, y));
    }
  return out;
}

/** Średni rozmiar kafla do szacunku: gmina miejska – gęste kafle miasta. */
export function avgTileBytes(kind?: GminaKind): number {
  return kind === 'miejska' ? URBAN_TILE_BYTES : AVG_TILE_BYTES;
}

/** Szacowany rozmiar `count` kafli (B). */
export function estimateBytes(count: number, kind?: GminaKind): number {
  return Math.max(0, count) * avgTileBytes(kind);
}

/** Suma zbiorów kafli wszystkich obszarów offline (kafle „przypięte” – nie wypadają z pamięci podręcznej). */
export function pinnedSet(areas: readonly { tiles: readonly string[] }[]): Set<string> {
  const out = new Set<string>();
  for (const a of areas) for (const k of a.tiles) out.add(k);
  return out;
}

/** Kafle usuwanego obszaru, których nie używa żaden inny obszar – tylko te kasujemy z dysku. */
export function exclusiveTiles(area: readonly string[], others: readonly (readonly string[])[]): string[] {
  const used = new Set<string>();
  for (const o of others) for (const k of o) used.add(k);
  return [...new Set(area)].filter((k) => !used.has(k));
}

/** Ile z `keys` jest dostępnych (`has`). */
export function coverage(keys: readonly string[], has: (key: string) => boolean): { have: number; total: number } {
  let have = 0;
  for (const k of keys) if (has(k)) have++;
  return { have, total: keys.length };
}

export interface CacheEntry {
  key: string;
  bytes: number;
  /** Ostatnie użycie (ms) – najdawniej używane wypadają pierwsze. */
  usedAt: number;
}

/**
 * LRU pamięci podręcznej: kafle (spoza obszarów offline) do usunięcia, żeby ich suma zmieściła się w `capBytes`.
 * Kafle przypięte nie liczą się do limitu i nigdy nie są wybierane.
 */
export function selectEvictions(entries: Iterable<CacheEntry>, pinned: ReadonlySet<string>, capBytes: number): string[] {
  const free: CacheEntry[] = [];
  let total = 0;
  for (const e of entries) {
    if (pinned.has(e.key)) continue;
    free.push(e);
    total += e.bytes;
  }
  if (total <= capBytes) return [];
  free.sort((a, b) => a.usedAt - b.usedAt || (a.key < b.key ? -1 : 1));
  const out: string[] = [];
  for (const e of free) {
    if (total <= capBytes) break;
    out.push(e.key);
    total -= e.bytes;
  }
  return out;
}

/**
 * Odległość (piksele świata) od punktu do najbliższego z kafli `keys` (0 = punkt w kaflu). Mapa okolicy z brakami
 * (offline): las szukamy tylko bliżej niż najbliższy brakujący kafel – dalej mógłby się kryć bliższy las.
 */
export function distanceToTilesPx(px: number, py: number, keys: readonly string[]): number {
  let best = Infinity;
  for (const k of keys) {
    const t = parseTileKey(k);
    if (!t) continue;
    const x0 = t.x * TILE_SIZE;
    const y0 = t.y * TILE_SIZE;
    const dx = Math.max(x0 - px, 0, px - (x0 + TILE_SIZE));
    const dy = Math.max(y0 - py, 0, py - (y0 + TILE_SIZE));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
