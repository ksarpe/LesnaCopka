/**
 * Mocki „geograficzne”: śledzenie wyprawy (GPS urządzenia albo symulowany spacer)
 * i dane gry dla dowolnej gminy z PRG (statystyki, ranking województwa).
 */
import { buildVoivodeshipRanking, GMINY, HEAT_WEEK, mockMushroomers, type VoivodeshipRanking } from '@/data/mock/gminy';
import { START_USER } from '@/data/mock/users';
import { gminaFromMeta, gminaIndex } from '@/geo';
import { DistanceFilter, nextWalkPoint, type LatLon, type TrackPoint, type WalkState } from '@/geo/track';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import type { Gmina, RankingPeriod } from '@/types';
import { hashString, mulberry32 } from '@/utils/random';

import { watchDevicePositions } from '../live/location';
import { ServiceError, type LocationService, type Unsubscribe } from '../types';

const sim = () => useSimStore.getState();

/* ───────────────────────── Śledzenie wyprawy ───────────────────────── */

type WatchCb = Parameters<LocationService['watchDistance']>[0];

/** Punkt „za granicą” w symulacji (Wilno) – jak w getCurrentRegion. */
const SIM_ABROAD: LatLon = { lat: 54.6872, lon: 25.2797 };
const SIM_TICK_MS = 2000;
/** Symulowany grzybiarz krąży w promieniu ok. 1 km od punktu symulacji. */
const SIM_RADIUS_M = 900;

/** Punkt symulacji (ten sam co w getCurrentRegion): wnętrze wybranej gminy albo Wilno. */
async function simOrigin(): Promise<LatLon> {
  const s = sim();
  if (s.simPoint === 'abroad') return SIM_ABROAD;
  const id = s.forcedGminaId ?? useUserStore.getState().user.homeGminaId ?? START_USER.homeGminaId;
  const meta = (await gminaIndex()).byId.get(id);
  if (!meta) throw new ServiceError('NOT_FOUND', `Brak granic gminy ${id}`);
  return { lon: meta.inner[0], lat: meta.inner[1] };
}

/** Tyle niedokładnych odczytów z rzędu (≈ 40 s) → podpowiedź o słabym sygnale. */
const WEAK_FIXES_HINT = 10;

/** Prawdziwy GPS: odczyty przez DistanceFilter (dokładność, drganie, skoki), błąd = jeden toast i brak przyrostów. */
function watchDevice(cb: WatchCb): Unsubscribe {
  const filter = new DistanceFilter();
  let warned = false;
  let weak = 0;
  let weakWarned = false;
  return watchDevicePositions(
    (fix) => {
      const v = filter.push(fix);
      // Długo tylko niedokładne odczyty (np. wyłączona „Dokładna lokalizacja” w iOS) – jedna podpowiedź.
      weak = !v.accepted && v.reason === 'accuracy' ? weak + 1 : 0;
      if (weak >= WEAK_FIXES_HINT && !weakWarned) {
        weakWarned = true;
        useUiStore.getState().showToast('Słaby sygnał GPS – dystans liczymy przy dokładności do 35 m', 'gps_off');
      }
      if (v.accepted) cb(v.deltaM / 1000, v.newSegment ? { ...fix, newSegment: true } : fix);
    },
    (e) => {
      if (warned) return;
      warned = true;
      useUiStore
        .getState()
        .showToast(
          e.code === 'PERMISSION' ? 'Brak zgody na lokalizację – dystans nie jest liczony' : 'GPS niedostępny – dystans nie jest liczony',
          'gps_off',
        );
    },
  );
}

/**
 * Symulacja: spacer ~4,2 km/h (×10 z panelu dev) wokół punktu symulacji. Wyłączony GPS w panelu
 * = nic nie przyrasta. `resumeFrom` – kontynuacja śladu (bez nowego odcinka).
 */
function watchSim(cb: WatchCb, resumeFrom?: LatLon): Unsubscribe {
  let walker: WalkState | null = null;
  let origin: LatLon | null = null;
  let stopped = false;
  simOrigin()
    .then((o) => {
      if (stopped) return;
      origin = o;
      const start = resumeFrom ?? o;
      walker = { lat: start.lat, lon: start.lon, heading: Math.random() * Math.PI * 2 };
      if (!resumeFrom) cb(0, { lat: start.lat, lon: start.lon, accuracyM: 8, t: Date.now(), newSegment: true });
    })
    // Bez punktu startu dystans nadal rośnie – tylko bez śladu.
    .catch(() => {});
  const t = setInterval(() => {
    const s = sim();
    if (!s.gpsEnabled) return;
    const km = (4.2 / 3600) * (SIM_TICK_MS / 1000) * s.timeSpeed * (0.7 + Math.random() * 0.6);
    let point: TrackPoint | undefined;
    if (walker && origin) {
      walker = nextWalkPoint(walker, km * 1000, Math.random, origin, SIM_RADIUS_M);
      point = { lat: walker.lat, lon: walker.lon, accuracyM: 8, t: Date.now() };
    }
    cb(km, point);
  }, SIM_TICK_MS);
  return () => {
    stopped = true;
    clearInterval(t);
  };
}

/** LocationService.watchDistance: GPS urządzenia albo symulowany spacer (wg panelu /dev). */
export const watchTripDistance: LocationService['watchDistance'] = (cb, opts) =>
  sim().locationSource === 'device' ? watchDevice(cb) : watchSim(cb, opts?.resumeFrom);

/* ───────────────────────── Gminy spoza danych gry ───────────────────────── */

const gameGmina = (id: string) => GMINY.find((g) => g.id === id);

/** Gmina spoza mocków: PRG nie zna grzybiarzy – liczba z generatora. */
export function withGameData(g: Gmina): Gmina {
  if (g.mushroomers > 0 || gameGmina(g.id)) return g;
  return { ...g, mushroomers: mockMushroomers(g) };
}

/** Gmina z danymi gry, wykryta z GPS albo dowolna z indeksu PRG (np. z rankingu innego województwa). */
export async function resolveGmina(id: string): Promise<Gmina> {
  const known = gameGmina(id);
  if (known) return known;
  const fromCatalog = useCatalogStore.getState().gminaById[id];
  if (fromCatalog) return withGameData(fromCatalog);
  const meta = (await gminaIndex()).byId.get(id);
  if (!meta) throw new ServiceError('NOT_FOUND', `Nie znaleziono gminy ${id}`);
  return withGameData(gminaFromMeta(meta));
}

const voivodeshipLists = new Map<string, Promise<Gmina[]>>();

/** Wszystkie gminy województwa z PRG z danymi gry (gminy z mocków + grzybiarze z generatora) – mapa gatunku. */
export function voivodeshipGminy(voivodeship: string): Promise<Gmina[]> {
  let p = voivodeshipLists.get(voivodeship);
  if (!p) {
    p = gminaIndex().then((index) => {
      const list = index.list
        .filter((m) => m.voivodeship === voivodeship)
        .map((m) => withGameData(gminaFromMeta(m, gameGmina(m.id))));
      if (!list.length) throw new ServiceError('NOT_FOUND', `Nieznane województwo ${voivodeship}`);
      return list;
    });
    p.catch(() => voivodeshipLists.delete(voivodeship));
    voivodeshipLists.set(voivodeship, p);
  }
  return p;
}

const rankings = new Map<string, Promise<VoivodeshipRanking>>();

/** Ranking województwa (spoza makiety) – wszystkie gminy z PRG, liczony raz na okres. */
export function voivodeshipRanking(period: RankingPeriod, voivodeship: string): Promise<VoivodeshipRanking> {
  const key = `${period}:${voivodeship}`;
  let p = rankings.get(key);
  if (!p) {
    p = gminaIndex().then((index) => {
      const list = index.list
        .filter((m) => m.voivodeship === voivodeship)
        .map((m) => withGameData(gminaFromMeta(m, gameGmina(m.id))));
      if (!list.length) throw new ServiceError('NOT_FOUND', `Nieznane województwo ${voivodeship}`);
      return buildVoivodeshipRanking(list, period);
    });
    p.catch(() => rankings.delete(key));
    rankings.set(key, p);
  }
  return p;
}

/** Stopień heatmapy gminy z makiety: „Tydzień” = wzór z pliku, „Sezon” i „Rekordy” – wariacje ±1. */
function designHeat(period: RankingPeriod, id: string): number {
  const base = HEAT_WEEK[id] ?? 0;
  if (period === 'week') return base;
  const r = mulberry32(hashString(`${period}:${id}`))();
  return Math.max(0, Math.min(4, base + Math.round(r * 2 - 1)));
}

/**
 * Mapa podlaskiego (makieta) na granicach PRG: gminy z danymi gry – stopnie z makiety, pozostałe
 * z generatora rankingu, ale chłodniejsze (kwintyle 0–4 → 0–2), żeby obszar z makiety się wyróżniał.
 * Grzybiarze dla podpowiedzi na mapie – dla gmin gry z mocków. Bez indeksu PRG – tylko gminy gry.
 */
export async function designVoivodeshipMap(
  period: RankingPeriod,
): Promise<{ heat: Record<string, number>; mushroomers: Record<string, number> }> {
  const heat: Record<string, number> = {};
  const mushroomers: Record<string, number> = {};
  const all = await voivodeshipRanking(period, 'podlaskie').catch(() => null);
  if (all) {
    for (const [id, level] of Object.entries(all.heat)) {
      heat[id] = Math.floor(level / 2);
      mushroomers[id] = all.mushroomers[id];
    }
  }
  for (const g of GMINY) {
    heat[g.id] = designHeat(period, g.id);
    mushroomers[g.id] = g.mushroomers;
  }
  return { heat, mushroomers };
}

/** Miejsce gminy spoza podlaskiego w tygodniowym rankingu jej województwa (zgodne z listą na ekranie Gminy). */
export async function rankInVoivodeship(g: Gmina): Promise<number | null> {
  if (!g.voivodeship || g.voivodeship === 'podlaskie') return null;
  const r = await voivodeshipRanking('week', g.voivodeship).catch(() => null);
  return r?.rows.find((x) => x.gminaId === g.id)?.rank ?? null;
}
