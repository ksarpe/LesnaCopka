/**
 * Mapy offline: obszary pobrane świadomie przez gracza (okolica 5 km, cała gmina) – w lesie bez zasięgu mapa
 * okolicy rysuje się z kafli na telefonie. Metadane obszarów w AsyncStorage (persist), kafle w tileStore
 * (src/services/live/tileStore.ts). Kafle obszaru są „przypięte”: nie wypadają z pamięci podręcznej (LRU)
 * i znikają dopiero z usunięciem obszaru – tylko te, których nie używa inny obszar.
 *
 * To nie są dane gry: „Wyczyść dane” (resetAll w src/store/game.ts) ich nie usuwa, eksport danych i usuwanie
 * konta ich nie dotyczą – zarządza nimi tylko ekran Ustawienia → Mapy offline.
 * Prywatność: obszar to prostokąt z kafli (dokładność ~3 km) i nazwa gminy – nigdy pozycja GPS.
 * Fair use OpenFreeMap: pobieramy tylko na wyraźne żądanie, maks. 4 kafle naraz, bez wznawiania w tle.
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { gminaIndex } from '@/geo';
import {
  estimateBytes,
  exclusiveTiles,
  keysBbox,
  parseTileKey,
  pinnedSet,
  rangeKeys,
  tileRangeAroundWorld,
  tileRangeForBbox,
  tileRangeForRadius,
  tilesForPolygons,
  type Bbox,
} from '@/geo/tiles';
import { tileStore, type TileUsage } from '@/services/live/tileStore';
import type { MapService } from '@/services/types';
import type { AreaMap, Gmina, GminaKind } from '@/types';
import { fmtMB, gminaTitle } from '@/utils/format';
import { makeId } from '@/utils/random';
import { persistStorage, STORAGE_KEYS } from './storage';
import { ui } from './useUiStore';

/** Okolica: kwadrat ±5 km wokół pozycji (obejmuje mapę pełnoekranową ±4 km z zapasem na spacer). */
export const AROUND_RADIUS_M = 5000;
/** Limit obszaru: 400 kafli z13 ≈ 3600 km² (~10 MB poza miastami) – większy nie zmieści się w jednej paczce. */
export const MAX_AREA_TILES = 400;
/** Powyżej tego szacunku pytamy, zanim zaczniemy pobierać. */
export const WARN_BYTES = 10_000_000;
/** Tyle błędów z rzędu = brak zasięgu – przerywamy zamiast czekać na każdy kafel. */
const MAX_CONSECUTIVE_FAILURES = 6;
/** Równoległe pobrania (fair use OpenFreeMap; i tak ogranicza je wspólny limit w map.ts). */
const CONCURRENCY = 4;

export type OfflineAreaKind = 'around' | 'gmina';
/** downloading – trwa pobieranie; ready – komplet; partial – brakuje kafli (błąd sieci, przerwane) → „Ponów”. */
export type OfflineAreaStatus = 'downloading' | 'ready' | 'partial';

export interface OfflineArea {
  id: string;
  kind: OfflineAreaKind;
  /** „Okolica – Supraśl”, „Gmina Hajnówka”. */
  name: string;
  /** Gmina (slug): cała gmina albo gmina, w której leży okolica. */
  gminaId: string;
  /** [W, S, E, N] – granice gminy z PRG albo prostokąt kafli okolicy (dokładność kafla, nie pozycja GPS). */
  bbox: Bbox;
  /** Klucze kafli „13/x/y”. */
  tiles: string[];
  /** Rozmiar pobranych kafli (B). */
  bytes: number;
  /** Kafle jeszcze niepobrane. */
  missing: number;
  createdAt: string;
  /** Koniec ostatniego pobierania (ISO); null – pierwsze jeszcze trwa. */
  downloadedAt: string | null;
  status: OfflineAreaStatus;
}

/** Postęp pobierania (tylko w pamięci). */
export interface OfflineJob {
  total: number;
  /** Kafle na telefonie (także te, które już były). */
  done: number;
  failed: number;
  bytes: number;
}

/** Propozycja obszaru do pobrania – z szacunkiem rozmiaru, zanim cokolwiek pobierzemy. */
export interface OfflinePlan {
  kind: OfflineAreaKind;
  name: string;
  gminaId: string;
  bbox: Bbox;
  tiles: string[];
  estimateBytes: number;
  /** Ponad MAX_AREA_TILES – nie pobieramy. */
  tooLarge: boolean;
  /** Szacunek ponad WARN_BYTES – pytamy przed pobraniem. */
  large: boolean;
}

interface OfflineMapsState {
  areas: OfflineArea[];
  jobs: Record<string, OfflineJob>;
  /** Podpowiedź „Pobierz mapę na offline, zanim wyjdziesz do lasu” – pokazana już raz. */
  hintShown: boolean;
}

export const useOfflineMapsStore = create<OfflineMapsState>()(
  persist((): OfflineMapsState => ({ areas: [], jobs: {}, hintShown: false }), {
    name: STORAGE_KEYS.offlineMaps,
    storage: persistStorage,
    version: 1,
    partialize: ({ areas, hintShown }) => ({ areas, hintShown }),
    // Pobieranie przerwane zamknięciem aplikacji nie wznawia się samo (fair use) – zostaje „Ponów”.
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<OfflineMapsState>;
      return {
        ...current,
        hintShown: !!p.hintShown,
        areas: (p.areas ?? []).map((a) => (a.status === 'downloading' ? { ...a, status: 'partial' as const } : a)),
      };
    },
  }),
);

const getState = () => useOfflineMapsStore.getState();
const findArea = (id: string) => getState().areas.find((a) => a.id === id);

function patchArea(id: string, patch: Partial<OfflineArea>) {
  useOfflineMapsStore.setState((s) => ({ areas: s.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
}

function setJob(id: string, job: OfflineJob | null) {
  useOfflineMapsStore.setState((s) => {
    const jobs = { ...s.jobs };
    if (job) jobs[id] = { ...job };
    else delete jobs[id];
    return { jobs };
  });
}

/* ───────────── Kafle przypięte ───────────── */

let pinnedMemo: { areas: OfflineArea[]; set: Set<string> } | null = null;

/** Kafle wszystkich obszarów offline (także w trakcie pobierania – od początku chronione przed LRU). */
export function pinnedTiles(): ReadonlySet<string> {
  const areas = getState().areas;
  if (pinnedMemo?.areas !== areas) pinnedMemo = { areas, set: pinnedSet(areas) };
  return pinnedMemo.set;
}

// Zanim obszary wczytają się z AsyncStorage, nie wiemy, które kafle są przypięte – LRU wtedy nic nie usuwa.
tileStore.setPinnedSource(() => (useOfflineMapsStore.persist.hasHydrated() ? pinnedTiles() : null));

/** Kafel w obszarze offline i na telefonie. */
const isOffline = (key: string) => pinnedTiles().has(key) && tileStore.has(key);

/** Czy cała mapa okolicy (jej zakres kafli) jest w obszarach offline – plakietka „Mapa offline ✓”. */
export function isAreaMapOffline(map: Pick<AreaMap, 'center' | 'radiusM' | 'metersPerPx' | 'zoom'>): boolean {
  const keys = rangeKeys(tileRangeAroundWorld(map.center.x, map.center.y, map.radiusM / map.metersPerPx, map.zoom));
  return keys.every(isOffline);
}

/* ───────────── Plany ───────────── */

function makePlan(kind: OfflineAreaKind, name: string, gminaId: string, tiles: string[], bbox: Bbox, gminaKind?: GminaKind): OfflinePlan {
  const est = estimateBytes(tiles.length, gminaKind);
  return {
    kind,
    name,
    gminaId,
    bbox,
    tiles,
    estimateBytes: est,
    tooLarge: tiles.length > MAX_AREA_TILES,
    large: est > WARN_BYTES,
  };
}

/** Okolica ±5 km wokół pozycji. Zapisujemy tylko kafle i ich prostokąt (nie pozycję). */
export function planAround(region: { gmina: Pick<Gmina, 'id' | 'name' | 'kind'>; position: { lat: number; lon: number } }): OfflinePlan {
  const tiles = rangeKeys(tileRangeForRadius(region.position.lat, region.position.lon, AROUND_RADIUS_M));
  const bbox = keysBbox(tiles) ?? [0, 0, 0, 0];
  return makePlan('around', `Okolica – ${region.gmina.name}`, region.gmina.id, tiles, bbox, region.gmina.kind);
}

/** Cała gmina: kafle, które dotykają jej granic z PRG (prostokąt z indeksu, gdy granic brak). */
export async function planGmina(gmina: Pick<Gmina, 'id' | 'name' | 'kind' | 'teryt'>): Promise<OfflinePlan> {
  const index = await gminaIndex();
  const meta = (gmina.teryt ? index.byTeryt.get(gmina.teryt) : undefined) ?? index.byId.get(gmina.id);
  if (!meta) throw new Error(`Brak granic gminy ${gmina.id}`);
  const polys = await index.geometry(meta.teryt);
  const tiles = polys.length ? tilesForPolygons(polys) : rangeKeys(tileRangeForBbox(meta.bbox));
  const kind = gmina.kind ?? meta.kind;
  return makePlan('gmina', gminaTitle({ name: gmina.name, kind }), gmina.id, tiles, meta.bbox, kind);
}

/** Obszar „cała gmina” dla tej gminy, jeśli już jest. */
export function gminaArea(areas: readonly OfflineArea[], gminaId: string): OfflineArea | undefined {
  return areas.find((a) => a.kind === 'gmina' && a.gminaId === gminaId);
}

/** Ile kafli planu jest już w obszarach offline (na telefonie). */
export function planCoverage(plan: Pick<OfflinePlan, 'tiles'>): { have: number; total: number } {
  let have = 0;
  for (const k of plan.tiles) if (isOffline(k)) have++;
  return { have, total: plan.tiles.length };
}

function uniqueName(name: string, areas: readonly OfflineArea[]): string {
  const taken = new Set(areas.map((a) => a.name));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`;
}

/* ───────────── Pobieranie ───────────── */

export interface DownloadTilesOptions {
  fetch: (x: number, y: number, signal: AbortSignal) => Promise<Uint8Array>;
  write: (key: string, bytes: Uint8Array) => Promise<void>;
  signal: AbortSignal;
  /** Po każdym kaflu: rozmiar zapisanego albo null (błąd). */
  onTile?: (key: string, bytes: number | null) => void;
  concurrency?: number;
  maxConsecutiveFailures?: number;
}

/**
 * Kolejka kafli: `concurrency` naraz, przerwanie sygnałem albo po `maxConsecutiveFailures` błędach z rzędu
 * (brak zasięgu – pozostałe kafle zostają do ponowienia). `offline` = przerwane przez brak sieci.
 */
export async function downloadTiles(keys: readonly string[], o: DownloadTilesOptions): Promise<{ failed: string[]; offline: boolean }> {
  const failed: string[] = [];
  const maxFail = o.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES;
  let next = 0;
  let streak = 0;
  let offline = false;
  const worker = async () => {
    while (!o.signal.aborted && !offline && next < keys.length) {
      const key = keys[next++];
      const t = parseTileKey(key);
      if (!t) continue;
      try {
        const bytes = await o.fetch(t.x, t.y, o.signal);
        if (o.signal.aborted) return;
        await o.write(key, bytes);
        streak = 0;
        o.onTile?.(key, bytes.length);
      } catch {
        if (o.signal.aborted) return;
        failed.push(key);
        o.onTile?.(key, null);
        if (++streak >= maxFail) offline = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? CONCURRENCY, keys.length)) }, worker));
  return { failed, offline };
}

const controllers = new Map<string, AbortController>();

/** Trwa pobieranie obszaru (w tej sesji). */
export const isDownloading = (id: string) => controllers.has(id);

async function runDownload(map: MapService, id: string): Promise<void> {
  if (controllers.has(id)) return;
  const ctrl = new AbortController();
  controllers.set(id, ctrl);
  try {
    await tileStore.ready();
    const area = findArea(id);
    if (!area || ctrl.signal.aborted) return;
    // Kafle już na telefonie (pamięć podręczna, inny obszar) – tylko je przypinamy, bez pobierania.
    const todo = area.tiles.filter((k) => !tileStore.has(k));
    const job: OfflineJob = {
      total: area.tiles.length,
      done: area.tiles.length - todo.length,
      failed: 0,
      bytes: tileStore.bytesOf(area.tiles),
    };
    patchArea(id, { status: 'downloading' });
    setJob(id, job);
    let last = 0;
    const res = await downloadTiles(todo, {
      fetch: (x, y, signal) => map.fetchTile(x, y, { signal }),
      write: (key, bytes) => tileStore.write(key, bytes),
      signal: ctrl.signal,
      onTile: (_, bytes) => {
        if (ctrl.signal.aborted) return;
        if (bytes == null) job.failed++;
        else {
          job.done++;
          job.bytes += bytes;
        }
        const now = Date.now();
        if (now - last > 150) {
          last = now;
          setJob(id, job);
        }
      },
    });
    if (ctrl.signal.aborted) return;
    // Indeks od razu na dysk – zamknięcie aplikacji tuż po pobraniu nie gubi kafli.
    await tileStore.flush();
    const done = findArea(id);
    if (!done) return;
    const missing = done.tiles.filter((k) => !tileStore.has(k)).length;
    const bytes = tileStore.bytesOf(done.tiles);
    patchArea(id, { status: missing ? 'partial' : 'ready', missing, bytes, downloadedAt: new Date().toISOString() });
    if (!missing) ui.toast(`Mapa offline gotowa: ${done.name} (${fmtMB(bytes)})`, 'offline_pin');
    else if (res.offline) ui.toast(`Brak połączenia – pobrano ${done.tiles.length - missing} z ${done.tiles.length}. Ponów w Mapach offline`, 'cloud_off');
    else ui.toast(`Nie pobrano ${missing} z ${done.tiles.length} kafli – ponów w Mapach offline`, 'warning');
  } finally {
    if (controllers.get(id) === ctrl) controllers.delete(id);
    setJob(id, null);
  }
}

/**
 * Nowy obszar offline z planu i start pobierania (w tle – postęp w `jobs`). Gmina pobrana wcześniej – ten sam
 * obszar (niepełny: ponowienie). Zwraca id obszaru albo null (obszar za duży / pusty).
 */
export function startOfflineDownload(map: MapService, plan: OfflinePlan): string | null {
  if (plan.tooLarge || !plan.tiles.length) return null;
  const st = getState();
  const existing = plan.kind === 'gmina' ? gminaArea(st.areas, plan.gminaId) : undefined;
  if (existing) {
    if (existing.status !== 'ready') void runDownload(map, existing.id);
    return existing.id;
  }
  const area: OfflineArea = {
    id: makeId('map'),
    kind: plan.kind,
    name: uniqueName(plan.name, st.areas),
    gminaId: plan.gminaId,
    bbox: plan.bbox,
    tiles: [...plan.tiles],
    bytes: 0,
    missing: plan.tiles.length,
    createdAt: new Date().toISOString(),
    downloadedAt: null,
    status: 'downloading',
  };
  // Obszar w store przed pierwszym kaflem – jego kafle są od razu przypięte (LRU ich nie ruszy).
  useOfflineMapsStore.setState((s) => ({ areas: [...s.areas, area] }));
  void runDownload(map, area.id);
  return area.id;
}

/** „Ponów” – dociąga brakujące kafle obszaru. */
export function retryOfflineArea(map: MapService, id: string): Promise<void> {
  return runDownload(map, id);
}

/** Usuwa obszar i jego kafle – poza tymi, których używa inny obszar. Trwające pobieranie jest przerywane. */
export async function deleteOfflineArea(id: string): Promise<void> {
  controllers.get(id)?.abort();
  controllers.delete(id);
  const area = findArea(id);
  setJob(id, null);
  if (!area) return;
  const others = getState().areas.filter((a) => a.id !== id);
  useOfflineMapsStore.setState({ areas: others });
  await tileStore.remove(
    exclusiveTiles(
      area.tiles,
      others.map((a) => a.tiles),
    ),
  );
}

/** Anulowanie pobierania = usunięcie niepełnego obszaru (kafle pobrane do tej pory też znikają). */
export async function cancelOfflineDownload(id: string): Promise<void> {
  await deleteOfflineArea(id);
  ui.toast('Anulowano pobieranie mapy', 'close');
}

/** Wyczyść pamięć podręczną map (kafle oglądane, spoza obszarów offline). Zwraca zwolnione bajty. */
export function clearMapCache(): Promise<number> {
  return tileStore.clearCache();
}

/**
 * Stan obszarów zgodny z dyskiem (np. przeglądarka wyczyściła IndexedDB, plik zniknął): brakujące kafle →
 * „niepełny”, rozmiary z indeksu. Wołane przy wejściu na ekrany map offline.
 */
export async function syncOfflineAreas(): Promise<void> {
  await tileStore.ready();
  for (const a of getState().areas) {
    if (controllers.has(a.id)) continue;
    const missing = a.tiles.filter((k) => !tileStore.has(k)).length;
    const bytes = tileStore.bytesOf(a.tiles);
    const status: OfflineAreaStatus = missing ? 'partial' : 'ready';
    if (missing !== a.missing || bytes !== a.bytes || status !== a.status) patchArea(a.id, { missing, bytes, status });
  }
}

/** Zajęte miejsce (obszary offline / pamięć podręczna) – odświeża się przy zmianach indeksu kafli. */
export function useTileUsage(): TileUsage {
  useSyncExternalStore(tileStore.subscribe, tileStore.getVersion, tileStore.getVersion);
  // Przypięcie zależy też od listy obszarów.
  useOfflineMapsStore((s) => s.areas);
  return tileStore.usage();
}

/** Limit pamięci podręcznej map (podpis w Ustawieniach). */
export { CACHE_CAP_BYTES } from '@/services/live/tileStore';

/** Gdzie leżą kafle: „memory” = przeglądarka bez IndexedDB – mapy offline znikną po zamknięciu karty. */
export function offlineStorageKind() {
  return tileStore.kind();
}

export function markOfflineHintShown() {
  if (!getState().hintShown) useOfflineMapsStore.setState({ hintShown: true });
}
