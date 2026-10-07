/**
 * Dekoder kafli MVT (schemat OpenMapTiles) do warstw mapy okolicy: lasy, woda, rzeki, drogi i drogi leśne.
 * Czysta funkcja bez I/O – używa jej mapa okolicy (src/services/live/map.ts) i skrypt kontrolny
 * (scripts/check-offline-tiles.ts).
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

import { TILE_SIZE } from './mercator';

export type LayerKey = 'forest' | 'water' | 'waterways' | 'roads' | 'tracks';
export type TileData = Record<LayerKey, number[][]>;

export const LAYER_KEYS: readonly LayerKey[] = ['forest', 'water', 'waterways', 'roads', 'tracks'];

const ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
const WATERWAYS = new Set(['river', 'stream', 'canal']);

export function emptyTileData(): TileData {
  return { forest: [], water: [], waterways: [], roads: [], tracks: [] };
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

/** Dekoduje kafel (x, y) do pikseli świata na jego poziomie (piksele kafla 256 × 256). Pusty bufor = pusty kafel. */
export function decodeTile(buf: ArrayBuffer | Uint8Array, x: number, y: number): TileData {
  const out = emptyTileData();
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!bytes.length) return out;
  const vt = new VectorTile(new PbfReader(bytes));
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
