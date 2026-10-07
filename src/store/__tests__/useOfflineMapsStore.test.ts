import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-require-imports */
/** AsyncStorage wspólny dla kolejnych „uruchomień” modułów (jest.resetModules) – jak pamięć telefonu. */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStorage.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStorage.set(k, v),
    removeItem: async (k: string) => void mockStorage.delete(k),
  },
}));
/** Komunikaty (toast) – bez prawdziwego store'u UI i jego timerów. */
const mockToasts: string[] = [];
jest.mock('../useUiStore', () => ({ ui: { toast: (text: string) => void mockToasts.push(text) } }));
// Kafle w pamięci zamiast plików telefonu (expo-file-system).
jest.mock('@/services/live/tileBackend', () => ({ openTileBackend: () => null }));
// Granice PRG prosto z assets/geo (zamiast expo-asset).
jest.mock('@/geo/assets.generated', () => {
  const codes = ['02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22', '24', '26', '28', '30', '32'];
  return {
    GMINY_INDEX_ASSET: 'gminy-index.geo',
    GMINY_SHARD_ASSETS: Object.fromEntries(codes.map((c) => [c, `gminy-${c}.geo`])),
  };
});
jest.mock('@/geo/readAssetText', () => ({
  readAssetText: async (name: string) => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'assets', 'geo', name), 'utf8');
  },
}));

type StoreModule = typeof import('../useOfflineMapsStore');
type TileStoreModule = typeof import('../../services/live/tileStore');
type Tiles = typeof import('../../geo/tiles');
type Mercator = typeof import('../../geo/mercator');

/** Świeże moduły (pusty magazyn kafli, store z AsyncStorage) – jak uruchomienie aplikacji. */
async function boot() {
  jest.resetModules();
  const m = {
    store: require('../useOfflineMapsStore') as StoreModule,
    tiles: require('../../services/live/tileStore') as TileStoreModule,
    geo: require('../../geo/tiles') as Tiles,
    mercator: require('../../geo/mercator') as Mercator,
  };
  await m.store.useOfflineMapsStore.persist.rehydrate();
  booted.push(m.tiles.tileStore);
  return m;
}

/** Magazyny kafli kolejnych „uruchomień” – na koniec testu zapisujemy indeksy (bez wiszących timerów). */
const booted: { flush(): Promise<void> }[] = [];
/* eslint-enable @typescript-eslint/no-require-imports */

/** Serwis mapy z kafelkami o rozmiarze zależnym od numeru; `fail` – klucze bez sieci; licznik równoległości. */
function fakeMap(opts: { fail?: (key: string) => boolean; delay?: number } = {}) {
  let inFlight = 0;
  const stats = { calls: [] as string[], maxInFlight: 0 };
  const map = {
    getAreaMap: () => Promise.reject(new Error('nieużywane')),
    async fetchTile(x: number, y: number) {
      const key = `13/${x}/${y}`;
      stats.calls.push(key);
      inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, opts.delay ?? 1));
        if (opts.fail?.(key)) throw new Error('Network request failed');
        return new Uint8Array(1000 + (x % 7) * 10 + (y % 5));
      } finally {
        inFlight--;
      }
    },
  };
  return { map, stats };
}

const sizeOf = (key: string) => {
  const [, x, y] = key.split('/').map(Number);
  return 1000 + (x % 7) * 10 + (y % 5);
};

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 2));
  }
}

const SUPRASL = { gmina: { id: 'suprasl', name: 'Supraśl', kind: 'miejsko-wiejska' as const }, position: { lat: 53.2097, lon: 23.3364 } };

let m: Awaited<ReturnType<typeof boot>>;

beforeEach(async () => {
  mockStorage.clear();
  mockToasts.length = 0;
  m = await boot();
});

afterEach(async () => {
  for (const t of booted.splice(0)) await t.flush();
});

const lastToast = () => mockToasts.at(-1);

const areaOf = (id: string) => m.store.useOfflineMapsStore.getState().areas.find((a) => a.id === id);
const settled = (id: string) => until(() => areaOf(id)?.status !== 'downloading' && !m.store.isDownloading(id));

describe('plany obszarów', () => {
  it('okolica: kafle ±5 km, nazwa z gminą, szacunek 25 KB / kafel, prostokąt z kafli zamiast pozycji', () => {
    const plan = m.store.planAround(SUPRASL);
    const keys = m.geo.rangeKeys(m.geo.tileRangeForRadius(SUPRASL.position.lat, SUPRASL.position.lon, 5000));
    expect(plan.name).toBe('Okolica – Supraśl');
    expect(plan.tiles).toEqual(keys);
    expect(plan.estimateBytes).toBe(keys.length * 25_000);
    expect(plan.tooLarge).toBe(false);
    // Prostokąt na granicach kafli – nie da się z niego odczytać dokładnej pozycji.
    expect(plan.bbox).toEqual(m.geo.keysBbox(keys));
    expect(plan.bbox[0]).not.toBeCloseTo(SUPRASL.position.lon - 0.0735, 3);
  });

  it('cała gmina z PRG: kafle z granic, nazwa „Gmina …”, prostokąt z indeksu', async () => {
    const plan = await m.store.planGmina({ id: 'suprasl', name: 'Supraśl', teryt: '2002093' });
    expect(plan.name).toBe('Gmina Supraśl');
    expect(plan.kind).toBe('gmina');
    expect(plan.tiles.length).toBeGreaterThan(10);
    expect(plan.tiles.length).toBeLessThan(m.store.MAX_AREA_TILES);
    expect(plan.estimateBytes).toBe(plan.tiles.length * 25_000);
    expect(plan.bbox[0]).toBeLessThan(SUPRASL.position.lon);
    expect(plan.bbox[2]).toBeGreaterThan(SUPRASL.position.lon);
    const city = await m.store.planGmina({ id: 'hajnowka-miasto', name: 'Hajnówka', kind: 'miejska' });
    expect(city.name).toBe('Miasto Hajnówka');
    expect(city.estimateBytes).toBe(city.tiles.length * 70_000);
  });
});

describe('pobieranie', () => {
  it('okolica: wszystkie kafle na telefonie, maks. 4 naraz, gotowa z rozmiarem i komunikatem', async () => {
    const { map, stats } = fakeMap();
    const plan = m.store.planAround(SUPRASL);
    const id = m.store.startOfflineDownload(map, plan)!;
    expect(areaOf(id)?.status).toBe('downloading');
    await settled(id);
    const area = areaOf(id)!;
    expect(area.status).toBe('ready');
    expect(area.missing).toBe(0);
    expect(area.bytes).toBe(plan.tiles.reduce((s, k) => s + sizeOf(k), 0));
    expect(area.downloadedAt).not.toBeNull();
    expect(stats.calls.sort()).toEqual([...plan.tiles].sort());
    expect(stats.maxInFlight).toBeLessThanOrEqual(4);
    expect(plan.tiles.every((k) => m.tiles.tileStore.has(k))).toBe(true);
    expect(m.store.useOfflineMapsStore.getState().jobs[id]).toBeUndefined();
    expect(lastToast()).toMatch(/^Mapa offline gotowa: Okolica – Supraśl \(/);
    // Mapa pełnoekranowa (±4 km) w tym miejscu jest w całości offline.
    const center = m.mercator.lonLatToWorld(SUPRASL.position.lon, SUPRASL.position.lat, 13);
    const mpp = m.mercator.metersPerPx(SUPRASL.position.lat, 13);
    expect(m.store.isAreaMapOffline({ center, radiusM: 4000, metersPerPx: mpp, zoom: 13 })).toBe(true);
    expect(m.store.isAreaMapOffline({ center: { x: center.x + 5000, y: center.y }, radiusM: 4000, metersPerPx: mpp, zoom: 13 })).toBe(false);
  });

  it('kafle już na telefonie (pamięć podręczna) tylko się przypina, bez ponownego pobrania', async () => {
    const plan = m.store.planAround(SUPRASL);
    const cached = plan.tiles.slice(0, 5);
    for (const k of cached) await m.tiles.tileStore.write(k, new Uint8Array(sizeOf(k)));
    expect(m.tiles.tileStore.usage().cacheTiles).toBe(5);
    const { map, stats } = fakeMap();
    const id = m.store.startOfflineDownload(map, plan)!;
    await settled(id);
    expect(stats.calls).toHaveLength(plan.tiles.length - 5);
    expect(stats.calls.some((k) => cached.includes(k))).toBe(false);
    expect(m.tiles.tileStore.usage()).toMatchObject({ cacheTiles: 0, pinnedTiles: plan.tiles.length });
    // Przypięte kafle nie znikają z „Wyczyść pamięć podręczną map”.
    await m.store.clearMapCache();
    expect(plan.tiles.every((k) => m.tiles.tileStore.has(k))).toBe(true);
  });

  it('błędy pojedynczych kafli → niepełny obszar; „Ponów” dociąga tylko brakujące', async () => {
    const plan = m.store.planAround(SUPRASL);
    const bad = new Set(plan.tiles.slice(3, 5));
    const first = fakeMap({ fail: (k) => bad.has(k) });
    const id = m.store.startOfflineDownload(first.map, plan)!;
    await settled(id);
    expect(areaOf(id)).toMatchObject({ status: 'partial', missing: 2 });
    expect(lastToast()).toMatch(/Nie pobrano 2 z/);

    const second = fakeMap();
    await m.store.retryOfflineArea(second.map, id);
    expect(second.stats.calls.sort()).toEqual([...bad].sort());
    expect(areaOf(id)).toMatchObject({ status: 'ready', missing: 0 });
  });

  it('brak zasięgu: po kilku błędach z rzędu przerywa zamiast próbować każdego kafla', async () => {
    const plan = m.store.planAround(SUPRASL);
    const { map, stats } = fakeMap({ fail: () => true });
    const id = m.store.startOfflineDownload(map, plan)!;
    await settled(id);
    expect(areaOf(id)).toMatchObject({ status: 'partial', missing: plan.tiles.length });
    expect(stats.calls.length).toBeLessThanOrEqual(6 + 3);
    expect(lastToast()).toMatch(/^Brak połączenia – pobrano 0 z/);
  });

  it('anulowanie usuwa obszar i pobrane kafle', async () => {
    const plan = m.store.planAround(SUPRASL);
    const { map } = fakeMap({ delay: 15 });
    const id = m.store.startOfflineDownload(map, plan)!;
    await until(() => plan.tiles.filter((k) => m.tiles.tileStore.has(k)).length >= 4);
    await m.store.cancelOfflineDownload(id);
    expect(areaOf(id)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 40)); // kafle „w locie” wracają po anulowaniu
    expect(m.store.useOfflineMapsStore.getState().jobs[id]).toBeUndefined();
    expect(m.tiles.tileStore.usage().pinnedTiles).toBe(0);
    expect(lastToast()).toBe('Anulowano pobieranie mapy');
  });

  it('gmina pobrana drugi raz – ten sam obszar, bez dubla', async () => {
    const plan = await m.store.planGmina({ id: 'suprasl', name: 'Supraśl', teryt: '2002093' });
    const { map, stats } = fakeMap();
    const id = m.store.startOfflineDownload(map, plan)!;
    await settled(id);
    const calls = stats.calls.length;
    expect(m.store.startOfflineDownload(map, plan)).toBe(id);
    expect(m.store.useOfflineMapsStore.getState().areas).toHaveLength(1);
    expect(stats.calls.length).toBe(calls);
    expect(m.store.gminaArea(m.store.useOfflineMapsStore.getState().areas, 'suprasl')?.id).toBe(id);
  });

  it('obszar ponad limit kafli – nie startuje', () => {
    const plan = { ...m.store.planAround(SUPRASL), tooLarge: true };
    expect(m.store.startOfflineDownload(fakeMap().map, plan)).toBeNull();
    expect(m.store.useOfflineMapsStore.getState().areas).toHaveLength(0);
  });
});

describe('usuwanie i stan po restarcie', () => {
  it('usunięcie obszaru kasuje tylko kafle, których nie używa inny obszar', async () => {
    const around = m.store.planAround(SUPRASL);
    const gmina = await m.store.planGmina({ id: 'suprasl', name: 'Supraśl', teryt: '2002093' });
    const { map } = fakeMap();
    const a = m.store.startOfflineDownload(map, around)!;
    await settled(a);
    const g = m.store.startOfflineDownload(map, gmina)!;
    await settled(g);
    const shared = around.tiles.filter((k) => gmina.tiles.includes(k));
    expect(shared.length).toBeGreaterThan(0);

    await m.store.deleteOfflineArea(a);
    expect(areaOf(a)).toBeUndefined();
    expect(gmina.tiles.every((k) => m.tiles.tileStore.has(k))).toBe(true);
    expect(around.tiles.filter((k) => !gmina.tiles.includes(k)).some((k) => m.tiles.tileStore.has(k))).toBe(false);
    expect(areaOf(g)?.status).toBe('ready');
  });

  it('dwie okolice w tej samej gminie – druga z numerem', async () => {
    const { map } = fakeMap();
    const a = m.store.startOfflineDownload(map, m.store.planAround(SUPRASL))!;
    await settled(a);
    const b = m.store.startOfflineDownload(map, m.store.planAround({ ...SUPRASL, position: { lat: 53.3, lon: 23.5 } }))!;
    await settled(b);
    expect(areaOf(b)?.name).toBe('Okolica – Supraśl (2)');
  });

  it('po restarcie: przerwane pobieranie = „niepełny” (bez wznawiania w tle), obszar na miejscu', async () => {
    const plan = m.store.planAround(SUPRASL);
    const { map } = fakeMap({ delay: 15 });
    const id = m.store.startOfflineDownload(map, plan)!;
    await until(() => plan.tiles.filter((k) => m.tiles.tileStore.has(k)).length >= 4);
    // Zapis AsyncStorage w chwili „zamknięcia aplikacji”.
    const saved = mockStorage.get('grzyb.offlinemaps.v1')!;
    expect(JSON.parse(saved).state.areas[0].status).toBe('downloading');
    await m.store.deleteOfflineArea(id); // zatrzymuje pobieranie w tym „procesie”
    mockStorage.set('grzyb.offlinemaps.v1', saved);

    m = await boot();
    const area = m.store.useOfflineMapsStore.getState().areas[0];
    expect(area).toMatchObject({ id, status: 'partial', name: 'Okolica – Supraśl' });
    expect(m.store.useOfflineMapsStore.getState().jobs).toEqual({});
    expect(m.store.isDownloading(id)).toBe(false);
  });

  it('syncOfflineAreas: kafel zniknął z dysku → obszar niepełny', async () => {
    const plan = m.store.planAround(SUPRASL);
    const id = m.store.startOfflineDownload(fakeMap().map, plan)!;
    await settled(id);
    await m.tiles.tileStore.remove([plan.tiles[0]]);
    await m.store.syncOfflineAreas();
    expect(areaOf(id)).toMatchObject({ status: 'partial', missing: 1 });
  });

  it('podpowiedź offline – zapamiętana raz', async () => {
    expect(m.store.useOfflineMapsStore.getState().hintShown).toBe(false);
    m.store.markOfflineHintShown();
    await new Promise((r) => setTimeout(r, 5));
    m = await boot();
    expect(m.store.useOfflineMapsStore.getState().hintShown).toBe(true);
  });
});

describe('kolejka kafli (downloadTiles)', () => {
  it('przerwanie sygnałem – bez kolejnych pobrań i bez raportu błędów', async () => {
    const ctrl = new AbortController();
    const seen: (number | null)[] = [];
    const keys = Array.from({ length: 20 }, (_, i) => `13/${i}/0`);
    let calls = 0;
    const res = await m.store.downloadTiles(keys, {
      signal: ctrl.signal,
      concurrency: 2,
      fetch: async () => {
        calls++;
        if (calls === 3) ctrl.abort();
        await new Promise((r) => setTimeout(r, 1));
        return new Uint8Array(5);
      },
      write: async () => {},
      onTile: (_, b) => seen.push(b),
    });
    expect(calls).toBeLessThanOrEqual(4);
    expect(res.failed).toEqual([]);
    expect(seen.every((b) => b === 5)).toBe(true);
  });
});
