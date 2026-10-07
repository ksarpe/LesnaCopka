/**
 * Mapa okolicy z wektorowych kafli MVT (schemat OpenMapTiles). Źródło: OpenFreeMap – dane OSM,
 * bez klucza API. Docelowo własne kafle (BDOT10k / Bank Danych o Lasach) – wystarczy podmienić
 * TILEJSON_URL, parser i renderer zostają.
 *
 * Kafel: pamięć (zdekodowany) → dysk (src/services/live/tileStore.ts – obszary offline i pamięć podręczna)
 * → sieć (zapis na dysk przy okazji). Bez zasięgu mapa składa się z tego, co jest na dysku; brakujące kafle
 * zostają puste (`AreaMap.missingTiles`).
 *
 * Do serwera kafli trafia tylko numer kafla (obszar ok. 3 × 3 km), nie dokładna pozycja.
 * Zasady OpenFreeMap (fair use): co najwyżej 4 kafle naraz (mapa i pobieranie obszarów razem), hurtowo
 * tylko to, co gracz sam wybierze do pobrania.
 */
import { gminaIndex } from '@/geo';
import { distanceToFilledRings } from '@/geo/geometry';
import { lonLatToWorld, metersPerPx, TILE_SIZE } from '@/geo/mercator';
import { decodeTile, emptyTileData, LAYER_KEYS, type TileData } from '@/geo/mvt';
import { distanceToTilesPx, rangeKeys, tileKey, tileRangeAroundWorld, TILE_ZOOM } from '@/geo/tiles';
import type { AreaMap } from '@/types';

import { ServiceError, type AreaMapOptions, type AreaMapRequest, type MapService } from '../types';
import { tileStore } from './tileStore';

export { decodeTile } from '@/geo/mvt';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const ATTRIBUTION = '© OpenStreetMap · OpenFreeMap';
/** Kafle z13: ok. 3 km na boku w Polsce, lasy już szczegółowe, a kafel waży 10–30 KB poza miastami. */
const ZOOM = TILE_ZOOM;
const MAX_CACHED_TILES = 48;
/** Równoległe pobrania kafli (fair use OpenFreeMap) – wspólne dla mapy i pobierania obszarów offline. */
export const MAX_PARALLEL_FETCHES = 4;
/** Słaby zasięg w lesie: kafel, który nie przyszedł w tym czasie, uznajemy za niedostępny. */
const FETCH_TIMEOUT_MS = 12_000;
/**
 * Po błędzie sieci przez tyle czasu mapa nie czeka na sieć (kafle z dysku od razu, reszta pusta) – w lesie
 * każdy kafel czekałby inaczej do FETCH_TIMEOUT_MS. Pierwsze udane pobranie kasuje przerwę.
 */
const NETWORK_BACKOFF_MS = 8_000;

let templatePromise: Promise<string> | null = null;
const tiles = new Map<string, Promise<TileData>>();
let networkDownUntil = 0;

/* ── Sieć: limit równoległości ── */

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL_FETCHES) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

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

/** Przerwanie z zewnątrz albo po FETCH_TIMEOUT_MS (AbortSignal.any / timeout nie są pewne w Hermesie). */
function linkedSignal(outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  outer?.addEventListener('abort', abort);
  const timer = setTimeout(abort, FETCH_TIMEOUT_MS);
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', abort);
    },
  };
}

/** Surowy kafel z sieci (bajty MVT); pusty kafel (204 / 404) = 0 bajtów. Błąd sieci → ServiceError('NETWORK'). */
export async function fetchTileBytes(x: number, y: number, signal?: AbortSignal): Promise<Uint8Array> {
  try {
    const tpl = await tileTemplate();
    return await withSlot(async () => {
      if (signal?.aborted) throw new ServiceError('CANCELLED', 'Przerwano');
      const link = linkedSignal(signal);
      try {
        const r = await fetch(tpl.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y)), {
          signal: link.signal,
        });
        if (r.status === 204 || r.status === 404) return new Uint8Array(0);
        if (!r.ok) throw new ServiceError('SERVER', `Kafel ${ZOOM}/${x}/${y}: ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        networkDownUntil = 0;
        return bytes;
      } finally {
        link.done();
      }
    });
  } catch (e) {
    if (signal?.aborted) throw new ServiceError('CANCELLED', 'Przerwano');
    if (e instanceof ServiceError) throw e;
    networkDownUntil = Date.now() + NETWORK_BACKOFF_MS;
    throw new ServiceError('NETWORK', 'Brak połączenia z serwerem mapy');
  }
}

/** Kafel spoza dysku i pamięci – bez zasięgu (albo w trybie offline) nie do zdobycia. */
const missing = () => new ServiceError('NETWORK', 'Kafel niedostępny offline');

/**
 * Kafel zdekodowany. `offline` (symulacja braku sieci w panelu dev) – tylko dysk, z pominięciem pamięci,
 * żeby sprawdzić prawdziwą ścieżkę „w lesie bez zasięgu”.
 */
function loadTile(x: number, y: number, offline: boolean): Promise<TileData> {
  const key = tileKey(ZOOM, x, y);
  const hit = offline ? undefined : tiles.get(key);
  if (hit) {
    // LRU: odśwież pozycję.
    tiles.delete(key);
    tiles.set(key, hit);
    return hit;
  }
  const p = (async () => {
    const disk = await tileStore.read(key).catch(() => null);
    if (disk) {
      if (offline || !tileStore.isStale(key) || Date.now() < networkDownUntil) return decodeTile(disk, x, y);
      // Stary kafel z pamięci podręcznej: przy zasięgu świeży, bez – ten z dysku.
      try {
        const fresh = await fetchTileBytes(x, y);
        void tileStore.write(key, fresh).catch(() => {});
        return decodeTile(fresh, x, y);
      } catch {
        return decodeTile(disk, x, y);
      }
    }
    if (offline || Date.now() < networkDownUntil) throw missing();
    const bytes = await fetchTileBytes(x, y);
    // Przy okazji na dysk (pamięć podręczna z limitem LRU) – następnym razem zadziała bez zasięgu.
    void tileStore.write(key, bytes).catch(() => {});
    return decodeTile(bytes, x, y);
  })();
  p.catch(() => tiles.delete(key));
  tiles.set(key, p);
  while (tiles.size > MAX_CACHED_TILES) tiles.delete(tiles.keys().next().value!);
  return p;
}

export const liveMap: MapService = {
  async getAreaMap(req: AreaMapRequest, opts?: AreaMapOptions): Promise<AreaMap> {
    const offline = !!opts?.offline;
    const center = lonLatToWorld(req.lon, req.lat, ZOOM);
    const mpp = metersPerPx(req.lat, ZOOM);
    const range = tileRangeAroundWorld(center.x, center.y, req.radiusM / mpp, ZOOM);
    const keys = rangeKeys(range);
    const results = await Promise.allSettled(
      keys.map((k) => {
        const [, x, y] = k.split('/').map(Number);
        return loadTile(x, y, offline);
      }),
    );

    const merged = emptyTileData();
    const lost: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        lost.push(keys[i]);
        return;
      }
      for (const k of LAYER_KEYS) merged[k].push(...r.value[k]);
    });
    // Bez kafla pod pozycją mapa nie ma sensu – placeholder „mapa niedostępna offline”.
    const centerKey = tileKey(ZOOM, Math.floor(center.x / TILE_SIZE), Math.floor(center.y / TILE_SIZE));
    if (lost.includes(centerKey) || lost.length === keys.length) {
      throw new ServiceError(
        'NETWORK',
        offline ? 'Brak mapy offline dla tej okolicy' : 'Nie udało się pobrać mapy okolicy',
      );
    }

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

    // Dane kompletne tylko do najbliższego brakującego kafla – dalej mógłby się kryć bliższy las.
    const completeRadiusM = lost.length ? Math.min(req.radiusM, distanceToTilesPx(center.x, center.y, lost) * mpp) : req.radiusM;
    // 0 = w lesie; kafle sąsiadują z zakładką, więc ten sam las może być w dwóch kaflach – reguła nonzero to znosi.
    const dPx = distanceToFilledRings(center.x, center.y, merged.forest);
    const dM = dPx * mpp;
    return {
      zoom: ZOOM,
      center,
      metersPerPx: mpp,
      ...merged,
      boundary,
      forestDistanceM: dM <= completeRadiusM ? Math.round(dM) : null,
      radiusM: req.radiusM,
      missingTiles: lost.length,
      completeRadiusM,
      attribution: ATTRIBUTION,
    };
  },

  fetchTile: (x, y, opts) => fetchTileBytes(x, y, opts?.signal),
};
