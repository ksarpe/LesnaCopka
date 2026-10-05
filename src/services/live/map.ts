/**
 * Mapa okolicy z wektorowych kafli MVT (schemat OpenMapTiles). Źródło: OpenFreeMap – dane OSM,
 * bez klucza API. Docelowo własne kafle (BDOT10k / Bank Danych o Lasach) – wystarczy podmienić
 * TILEJSON_URL, parser i renderer zostają.
 *
 * Do serwera kafli trafia tylko numer kafla (obszar ok. 3 × 3 km), nie dokładna pozycja.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

import { gminaIndex } from '@/geo';
import { distanceToFilledRings } from '@/geo/geometry';
import { lonLatToWorld, metersPerPx, TILE_SIZE } from '@/geo/mercator';
import type { AreaMap } from '@/types';

import { ServiceError, type AreaMapRequest, type MapService } from '../types';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const ATTRIBUTION = '© OpenStreetMap · OpenFreeMap';
/** Kafle z13: ok. 3 km na boku w Polsce, lasy już szczegółowe, a kafel waży 10–30 KB poza miastami. */
const ZOOM = 13;
const MAX_CACHED_TILES = 48;

type LayerKey = 'forest' | 'water' | 'waterways' | 'roads' | 'tracks';
type TileData = Record<LayerKey, number[][]>;

const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
const WATERWAYS = new Set(['river', 'stream', 'canal']);

let templatePromise: Promise<string> | null = null;
const tiles = new Map<string, Promise<TileData>>();

function tileTemplate(): Promise<string> {
  if (!templatePromise) {
    const p = fetch(TILEJSON_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`TileJSON ${r.status}`);
        return r.json() as Promise<{ tiles: string[] }>;
      })
      .then((j) => j.tiles[0]);
    p.catch(() => {
      templatePromise = null;
    });
    templatePromise = p;
  }
  return templatePromise;
}

function pick(layer: string, type: number, p: Record<string, unknown>): LayerKey | null {
  switch (layer) {
    case 'landcover':
      return type === 3 && p.class === 'wood' ? 'forest' : null;
    case 'water':
      return type === 3 ? 'water' : null;
    case 'waterway':
      return type === 2 && WATERWAYS.has(String(p.class)) ? 'waterways' : null;
    case 'transportation':
      if (type !== 2) return null;
      if (ROADS.has(String(p.class))) return 'roads';
      return p.class === 'track' || (p.class === 'path' && p.subclass === 'path') ? 'tracks' : null;
    default:
      return null;
  }
}

/** Dekoduje kafel do pikseli świata na poziomie ZOOM (piksele kafla 256 × 256). */
export function decodeTile(buf: ArrayBuffer, x: number, y: number): TileData {
  const out: TileData = { forest: [], water: [], waterways: [], roads: [], tracks: [] };
  const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));
  for (const name of ['landcover', 'water', 'waterway', 'transportation']) {
    const layer = vt.layers[name];
    if (!layer) continue;
    const k = TILE_SIZE / layer.extent;
    const ox = x * TILE_SIZE;
    const oy = y * TILE_SIZE;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const key = pick(name, f.type, f.properties);
      if (!key) continue;
      for (const ring of f.loadGeometry()) {
        const flat = new Array<number>(ring.length * 2);
        for (let j = 0; j < ring.length; j++) {
          flat[2 * j] = ox + ring[j].x * k;
          flat[2 * j + 1] = oy + ring[j].y * k;
        }
        out[key].push(flat);
      }
    }
  }
  return out;
}

function loadTile(x: number, y: number): Promise<TileData> {
  const key = `${ZOOM}/${x}/${y}`;
  const hit = tiles.get(key);
  if (hit) {
    // LRU: odśwież pozycję.
    tiles.delete(key);
    tiles.set(key, hit);
    return hit;
  }
  const p = tileTemplate()
    .then((tpl) => fetch(tpl.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y))))
    .then((r) => {
      if (r.status === 204 || r.status === 404) return new ArrayBuffer(0);
      if (!r.ok) throw new Error(`Kafel ${key}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => decodeTile(buf, x, y));
  p.catch(() => tiles.delete(key));
  tiles.set(key, p);
  while (tiles.size > MAX_CACHED_TILES) tiles.delete(tiles.keys().next().value!);
  return p;
}

export const liveMap: MapService = {
  async getAreaMap(req: AreaMapRequest): Promise<AreaMap> {
    const center = lonLatToWorld(req.lon, req.lat, ZOOM);
    const mpp = metersPerPx(req.lat, ZOOM);
    const r = req.radiusM / mpp;
    const x0 = Math.floor((center.x - r) / TILE_SIZE);
    const x1 = Math.floor((center.x + r) / TILE_SIZE);
    const y0 = Math.floor((center.y - r) / TILE_SIZE);
    const y1 = Math.floor((center.y + r) / TILE_SIZE);
    const jobs: Promise<TileData>[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(loadTile(x, y));

    let parts: TileData[];
    try {
      parts = await Promise.all(jobs);
    } catch {
      throw new ServiceError('NETWORK', 'Nie udało się pobrać mapy okolicy');
    }
    const merged: TileData = { forest: [], water: [], waterways: [], roads: [], tracks: [] };
    for (const t of parts) for (const k of Object.keys(merged) as LayerKey[]) merged[k].push(...t[k]);

    let boundary: number[][] = [];
    if (req.gminaTeryt) {
      const polys = await (await gminaIndex()).geometry(req.gminaTeryt);
      boundary = polys.flatMap((p) =>
        p.map((ring) => {
          const flat = new Array<number>(ring.length);
          for (let i = 0; i < ring.length; i += 2) {
            const w = lonLatToWorld(ring[i], ring[i + 1], ZOOM);
            flat[i] = w.x;
            flat[i + 1] = w.y;
          }
          return flat;
        }),
      );
    }

    // 0 = w lesie; kafle sąsiadują z zakładką, więc ten sam las może być w dwóch kaflach – reguła nonzero to znosi.
    const dPx = distanceToFilledRings(center.x, center.y, merged.forest);
    const dM = dPx * mpp;
    return {
      zoom: ZOOM,
      center,
      metersPerPx: mpp,
      ...merged,
      boundary,
      forestDistanceM: dM <= req.radiusM ? Math.round(dM) : null,
      radiusM: req.radiusM,
      attribution: ATTRIBUTION,
    };
  },
};
