/**
 * Implementacje mock wszystkich serwisów. Opóźnienia 300–1500 ms, losowość ze stałym seedem.
 * Stan symulacji (GPS, sieć, wymuszony skan) czytają z useSimStore – sterowanego z panelu /dev.
 */
import { BADGES, DAILY_QUESTS } from '@/data/mock/game';
import { buildGminaStats, GMINY, HEAT_WEEK, RANKINGS } from '@/data/mock/gminy';
import { refreshPool } from '@/data/mock/feed';
import { SPECIES, TOTAL_SPECIES } from '@/data/mock/species';
import { START_USER } from '@/data/mock/users';
import { gminaIndex } from '@/geo';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useUiStore } from '@/store/useUiStore';
import type {
  Dimensions,
  Identification,
  Post,
  RankingPeriod,
  Rarity,
  ScanPart,
  ScanResult,
  Species,
  Trip,
  TripPost,
} from '@/types';
import { hashString, makeId, mulberry32, sleep } from '@/utils/random';
import { isXxl } from '@/utils/xp';
import { fmtInt } from '@/utils/format';
import { useUserStore } from '@/store/useUserStore';
import { useTripStore } from '@/store/useTripStore';
import {
  ServiceError,
  type CatalogService,
  type FeedService,
  type IdentifyService,
  type LocationService,
  type MapService,
  type PermissionKind,
  type PermissionService,
  type PermissionStatus,
  type ScanService,
  type Services,
  type StatsService,
} from '../types';
import { liveMap } from '../live/map';
import { livePermissions, readDevicePosition, regionAt } from '../live/location';
import { useMockDb } from './db';

const sim = () => useSimStore.getState();

/** Opóźnienie sieci 300–1500 ms (deterministyczne dla danego klucza). */
async function net(key: string, min = 300, max = 1100) {
  const r = mulberry32(hashString(key + Date.now().toString().slice(0, -3)))();
  await sleep(min + Math.round(r * (max - min)));
  if (!sim().networkEnabled) throw new ServiceError('NETWORK', 'Brak połączenia z siecią');
}

/** Gmina z danymi gry (mocki) albo wykryta z GPS i dopisana do katalogu (dowolna gmina w Polsce). */
function gminaById(id: string) {
  const g = GMINY.find((x) => x.id === id) ?? useCatalogStore.getState().gminaById[id];
  if (!g) throw new ServiceError('NOT_FOUND', `Nie znaleziono gminy ${id}`);
  return g;
}

/** Gmina „bieżąca” dla mocków feedu i heatmapy: wybrana w symulacji albo domowa. */
function simGminaId() {
  const s = sim();
  const home = useUserStore.getState().user.homeGminaId;
  return s.locationSource === 'sim' ? (s.forcedGminaId ?? home) : home;
}

/* ───────────────────────── Uprawnienia ───────────────────────── */

const PROMPT_COPY: Record<PermissionKind, { title: string; message: string; allow: string }> = {
  location: {
    title: '„Grzybobranie” chce używać Twojej lokalizacji',
    message: 'Lokalizacja wskazuje gminę i liczy dystans wyprawy. Nigdy nie publikujemy jej na żywo.',
    allow: 'Pozwól podczas używania',
  },
  camera: {
    title: '„Grzybobranie” chce uzyskać dostęp do aparatu',
    message: 'Aparat jest potrzebny do skanu 360° i rozpoznania gatunku.',
    allow: 'Pozwól',
  },
};

const pendingPrompts: Partial<Record<PermissionKind, Promise<PermissionStatus>>> = {};

const deviceLocation = () => sim().locationSource === 'device';

/** Tryb „GPS urządzenia”: stan zgody systemowej odbijamy w useSimStore, żeby UI działało jak w symulacji. */
async function syncDevicePermission() {
  try {
    sim().setPermission('location', await livePermissions.location());
  } catch {
    // np. przeglądarka bez Permissions API – zostaje poprzedni stan
  }
}

export const mockPermissions: PermissionService = {
  get: (kind) => sim().permissions[kind],
  request: (kind) => {
    if (kind === 'location' && deviceLocation()) {
      return livePermissions.requestLocation().then(
        (st) => {
          sim().setPermission('location', st);
          return st;
        },
        () => sim().permissions.location,
      );
    }
    const current = sim().permissions[kind];
    if (current !== 'undetermined') return Promise.resolve(current);
    // Jeden prompt naraz – kolejne wywołania czekają na tę samą odpowiedź.
    const existing = pendingPrompts[kind];
    if (existing) return existing;
    const p = new Promise<PermissionStatus>((resolve) => {
      const copy = PROMPT_COPY[kind];
      const done = (status: 'granted' | 'denied') => {
        delete pendingPrompts[kind];
        sim().setPermission(kind, status);
        resolve(status);
      };
      useUiStore.getState().showDialog({
        variant: 'system',
        title: copy.title,
        message: copy.message,
        actions: [
          { label: copy.allow, style: 'primary', onPress: () => done('granted') },
          { label: 'Nie pozwalaj', style: 'default', onPress: () => done('denied') },
        ],
      });
    });
    pendingPrompts[kind] = p;
    return p;
  },
};

/* ───────────────────────── Lokalizacja ───────────────────────── */

/** Punkt „za granicą” w symulacji (Wilno). */
const ABROAD = { lat: 54.6872, lon: 25.2797 };
/** Dane gry (statystyki, kompleks leśny) mają tylko gminy z mocków. */
const knownGmina = (id: string) => GMINY.find((g) => g.id === id);

export const mockLocation: LocationService = {
  async getCurrentRegion(previous) {
    if (deviceLocation()) {
      try {
        return await regionAt(await readDevicePosition(), { source: 'device', previous, known: knownGmina });
      } finally {
        syncDevicePermission();
      }
    }
    await sleep(700);
    const s = sim();
    if (!s.gpsEnabled) throw new ServiceError('GPS_OFF', 'Lokalizacja jest wyłączona');
    if (s.permissions.location === 'denied') throw new ServiceError('PERMISSION', 'Brak zgody na lokalizację');
    const at = new Date().toISOString();
    if (s.simPoint === 'abroad') {
      return regionAt({ ...ABROAD, accuracyM: 20, at }, { source: 'sim', previous, known: knownGmina });
    }
    // Punkt wewnątrz wybranej gminy (z PRG) – dalej ta sama ścieżka co prawdziwy GPS.
    const id = s.forcedGminaId ?? useUserStore.getState().user.homeGminaId ?? START_USER.homeGminaId;
    const meta = (await gminaIndex()).byId.get(id);
    if (!meta) throw new ServiceError('NOT_FOUND', `Brak granic gminy ${id}`);
    const accuracyM = s.simPoint === 'coarse' ? 1500 : 12;
    return regionAt({ lon: meta.inner[0], lat: meta.inner[1], accuracyM, at }, { source: 'sim', previous, known: knownGmina });
  },
  watchDistance(cb) {
    // Spacer ~4,2 km/h; przy ×10 czas i dystans płyną 10× szybciej.
    const tickMs = 2000;
    const t = setInterval(() => {
      const s = sim();
      if (!s.gpsEnabled) return;
      const kmPerTick = (4.2 / 3600) * (tickMs / 1000) * s.timeSpeed;
      cb(kmPerTick * (0.7 + Math.random() * 0.6));
    }, tickMs);
    return () => clearInterval(t);
  },
};

/* ───────────────────────── Mapa okolicy ───────────────────────── */

/** Prawdziwe kafle (OpenFreeMap); przełącznik sieci z panelu dev symuluje brak połączenia. */
export const mockMap: MapService = {
  async getAreaMap(req, opts) {
    if (!sim().networkEnabled) {
      await sleep(400);
      throw new ServiceError('NETWORK', 'Brak połączenia – mapa okolicy niedostępna');
    }
    return liveMap.getAreaMap(req, opts);
  },
};

/* ───────────────────────── Skan 360° ───────────────────────── */

const PART_ORDER: ScanPart[] = ['cap', 'underside', 'stem', 'base'];
/** Progi zaliczenia części (przy 68% zaliczone są 3 z 4 – jak w makiecie). */
const PART_AT = [0.15, 0.4, 0.65, 0.95];

export const mockScan: ScanService = {
  startScan(cb, opts) {
    return new Promise<ScanResult>((resolve, reject) => {
      const duration = 4000;
      const started = Date.now();
      const tick = setInterval(() => {
        if (opts?.signal?.aborted) {
          clearInterval(tick);
          reject(new ServiceError('CANCELLED', 'Skan przerwany'));
          return;
        }
        const freeze = sim().scanFreezeAt;
        const p = Math.min(freeze ?? 1, (Date.now() - started) / duration);
        const parts = PART_ORDER.filter((_, i) => p >= PART_AT[i]);
        cb(p, parts);
        if (p >= 1) {
          clearInterval(tick);
          resolve({ id: makeId('scan'), parts: PART_ORDER, capturedAt: new Date().toISOString() });
        }
      }, 50);
    });
  },
  capturePartial(parts) {
    return { id: makeId('scan'), parts, capturedAt: new Date().toISOString() };
  },
};

/* ───────────────────────── Rozpoznawanie ───────────────────────── */

const RARITY_WEIGHTS: Record<Rarity, number> = { pospolity: 60, rzadki: 26, epicki: 10, legendarny: 4 };

function pickSpecies(rnd: () => number, pool: Species[]) {
  const total = pool.reduce((a, s) => a + RARITY_WEIGHTS[s.rarity], 0);
  let x = rnd() * total;
  for (const s of pool) {
    x -= RARITY_WEIGHTS[s.rarity];
    if (x <= 0) return s;
  }
  return pool[0];
}

export const mockIdentify: IdentifyService = {
  async identify(scan) {
    await sleep(1500);
    const s = sim();
    if (!s.networkEnabled) throw new ServiceError('NETWORK', 'Brak sieci – rozpoznanie wymaga połączenia');
    const seq = s.scanSeq;
    s.set({ scanSeq: seq + 1 });
    const rnd = mulberry32(1000 + seq * 7919);
    const o = s.scan;

    let species: Species;
    if (o.speciesId) {
      species = SPECIES.find((x) => x.id === o.speciesId) ?? SPECIES[0];
    } else if (o.poisonous) {
      const poison = SPECIES.filter((x) => x.edibility === 'trujacy' || x.edibility === 'smiertelny');
      species = poison[Math.floor(rnd() * poison.length)];
    } else if (seq === 0) {
      // Pierwszy skan = scenariusz z makiety: borowik szlachetny XXL, 410 g.
      species = SPECIES[0];
    } else {
      const pool = SPECIES.filter((x) => x.edibility !== 'smiertelny' || rnd() < 0.15);
      species = pickSpecies(rnd, pool);
    }

    const t = species.typical;
    let dims: Dimensions;
    let xxl: boolean;
    if (seq === 0 && !o.speciesId && !o.poisonous) {
      dims = { capCm: 14, heightCm: 17, weightG: 410, ageDays: 5 };
      xxl = true;
    } else {
      const forceXxl = o.xxl === true;
      const scale = forceXxl ? 1.3 + rnd() * 0.3 : o.xxl === false ? 0.75 + rnd() * 0.4 : 0.75 + rnd() * 0.65;
      dims = {
        capCm: Math.max(2, Math.round(t.capCm * scale)),
        heightCm: Math.max(3, Math.round(t.heightCm * scale)),
        weightG: Math.max(5, Math.round((t.weightG * scale * scale) / 5) * 5),
        ageDays: 2 + Math.floor(rnd() * 6),
        pieces: species.clustered ? 6 + Math.floor(rnd() * 10) : undefined,
      };
      if (species.clustered && dims.pieces) dims.weightG = dims.pieces * t.weightG;
      xxl = o.xxl ?? (!species.clustered && isXxl(dims.weightG, t.weightG));
    }

    const low = o.lowConfidence;
    const confidence = low ? 0.42 + rnd() * 0.15 : seq === 0 ? 0.96 : 0.86 + rnd() * 0.13;
    const others = SPECIES.filter((x) => x.id !== species.id);
    const candidates = low
      ? [
          { speciesId: species.id, confidence },
          { speciesId: others[Math.floor(rnd() * others.length)].id, confidence: confidence * 0.7 },
          { speciesId: others[Math.floor(rnd() * others.length)].id, confidence: confidence * 0.45 },
        ]
      : [{ speciesId: species.id, confidence }];

    const result: Identification = {
      speciesId: species.id,
      confidence,
      rarity: o.rarity ?? species.rarity,
      xxl,
      dimensions: dims,
      lookalikes: species.lookalike ? [species.lookalike] : [],
      candidates,
    };
    return result;
  },
};

/* ───────────────────────── Statystyki ───────────────────────── */

export const mockStats: StatsService = {
  async getGminaStats(id) {
    await net(`gmina:${id}`, 400, 900);
    const g = gminaById(id);
    const rankIdx = RANKINGS.week.findIndex((r) => r.id === id);
    const rank = rankIdx >= 0 ? rankIdx + 1 : 6 + (hashString(id) % 30);
    return buildGminaStats(g, rank);
  },
  async getRanking(period: RankingPeriod) {
    await net(`ranking:${period}`, 350, 800);
    const seeds = RANKINGS[period];
    const heat: Record<string, number> = {};
    GMINY.forEach((g) => {
      if (period === 'week') heat[g.id] = HEAT_WEEK[g.id] ?? 0;
      else {
        const r = mulberry32(hashString(`${period}:${g.id}`))();
        const base = HEAT_WEEK[g.id] ?? 0;
        heat[g.id] = Math.max(0, Math.min(4, base + Math.round(r * 2 - 1)));
      }
    });
    const home = simGminaId();
    heat[home] = 4;
    return {
      period,
      heat,
      userContribution: useUserStore.getState().weeklyContribution,
      rows: seeds.map((s, i) => {
        const g = gminaById(s.id);
        return {
          gminaId: g.id,
          rank: i + 1,
          name: g.name,
          sub: `${g.forest ?? `powiat ${g.powiat ?? ''}`} · ${fmtInt(g.mushroomers)} grzybiarzy`,
          points: s.points,
          trend: s.trend,
        };
      }),
    };
  },
  async getSpeciesPercentile(speciesId, gminaId, size) {
    await net(`pct:${speciesId}:${gminaId}`, 300, 700);
    const sp = SPECIES.find((x) => x.id === speciesId) ?? SPECIES[0];
    const rnd = mulberry32(hashString(`${speciesId}|${gminaId}`));
    const special = speciesId === 'borowik-szlachetny' && gminaId === 'suprasl';
    const collected = special ? 312 : 20 + Math.floor(rnd() * 400);
    const mushroomers = special ? 41 : Math.max(3, Math.round(collected / (5 + rnd() * 5)));
    const ratio = size.weightG / Math.max(1, sp.typical.weightG);
    const percentile = Math.max(3, Math.min(99, Math.round(50 + (ratio - 1) * 135)));
    const sizeRank = Math.max(1, Math.round((100 - percentile) / 3));
    return { speciesId, gminaId, collected, mushroomers, percentile, sizeRank, biggerCount: sizeRank - 1 };
  },
};

/* ───────────────────────── Feed ───────────────────────── */

const DAY = 24 * 3600_000;

function inScope(p: Post, scope: 'friends' | 'gmina') {
  // Prywatność: cudze wpisy widać dopiero od visibleFrom; własne – od razu (z adnotacją).
  const mine = p.kind === 'trip' && p.mine;
  if (!mine && new Date(p.visibleFrom).getTime() > Date.now()) return false;
  if (scope === 'friends') return p.scopes.includes('friends');
  const home = simGminaId();
  return p.scopes.includes('gmina') && p.gminaId === home;
}

export const mockFeed: FeedService = {
  async getFeed(scope) {
    await net(`feed:${scope}`, 500, 1200);
    return useMockDb.getState().posts.filter((p) => inScope(p, scope));
  },
  async loadNewer(scope) {
    await net(`newer:${scope}`, 700, 1300);
    const db = useMockDb.getState();
    const pool = refreshPool(Date.now());
    const take = db.refreshCount % 2 === 0 ? 2 : 1;
    const start = (db.refreshCount * 2) % pool.length;
    const fresh = Array.from({ length: take }, (_, i) => pool[(start + i) % pool.length]).map((p) =>
      scope === 'gmina' ? { ...p, scopes: [...new Set([...p.scopes, 'gmina' as const])], gminaId: simGminaId() } : p,
    );
    db.set({ posts: [...fresh, ...db.posts], refreshCount: db.refreshCount + 1 });
    return useMockDb.getState().posts.filter((p) => inScope(p, scope));
  },
  async publishTrip(trip: Trip, { hideRoute }) {
    await net(`publish:${trip.id}`, 800, 1400);
    const finds = trip.findIds.map((id) => useTripStore.getState().finds[id]).filter((f) => f && f.status === 'claimed');
    const collected = finds.filter((f) => f.collected);
    const rank = (r: Rarity) => ['pospolity', 'rzadki', 'epicki', 'legendarny'].indexOf(r);
    const best = [...finds].sort((a, b) => rank(b.rarity) - rank(a.rarity) || (b.xp?.total ?? 0) - (a.xp?.total ?? 0))[0];
    const bestSpecies = best ? SPECIES.find((s) => s.id === best.speciesId) : undefined;
    const user = useUserStore.getState().user;
    const now = new Date();
    const post: TripPost = {
      id: makeId('post'),
      kind: 'trip',
      mine: true,
      author: { id: user.id, name: user.firstName, level: user.level, ringRarity: 'primary' },
      gminaId: trip.gminaId,
      createdAt: trip.endedAt ?? now.toISOString(),
      publishedAt: now.toISOString(),
      // Prywatność: inni zobaczą wpis dopiero po 24 h, nigdy na żywo.
      visibleFrom: new Date(now.getTime() + DAY).toISOString(),
      scopes: ['friends', 'gmina'],
      title: trip.distanceKm >= 5 ? 'Długa wyprawa po Puszczy' : 'Wyprawa po grzyby',
      distanceKm: Math.round(trip.distanceKm * 10) / 10,
      durationMin: Math.round(trip.elapsedMs / 60000),
      mushrooms: collected.length,
      species: new Set(collected.map((f) => f.speciesId)).size,
      xp: trip.xp,
      routePrecision: hideRoute ? 'gmina' : 'approximate',
      highlight:
        best && bestSpecies
          ? {
              rarity: best.rarity,
              text: `${bestSpecies.name.split(' (')[0]} ${best.dimensions.weightG >= 1000 ? (best.dimensions.weightG / 1000).toFixed(1).replace('.', ',') + ' kg' : best.dimensions.weightG + ' g'}`,
            }
          : undefined,
      reactions: 0,
      reacted: false,
      comments: 0,
    };
    const db = useMockDb.getState();
    db.set({ posts: [post, ...db.posts] });
    return post;
  },
  async toggleReaction(postId) {
    await net(`react:${postId}`, 150, 300);
    const db = useMockDb.getState();
    let out = { reacted: false, reactions: 0 };
    db.set({
      posts: db.posts.map((p) => {
        if (p.id !== postId || p.kind !== 'trip') return p;
        const reacted = !p.reacted;
        out = { reacted, reactions: p.reactions + (reacted ? 1 : -1) };
        return { ...p, ...out };
      }),
    });
    return out;
  },
};

/* ───────────────────────── Katalog ───────────────────────── */

export const mockCatalog: CatalogService = {
  async getSpecies() {
    await sleep(120);
    return SPECIES;
  },
  async getGminy() {
    return GMINY;
  },
  async getBadges() {
    return BADGES;
  },
  async getDailyQuests() {
    return DAILY_QUESTS;
  },
  async getTotalSpecies() {
    return TOTAL_SPECIES;
  },
};

type Persisted = { persist: { hasHydrated(): boolean; onFinishHydration(cb: () => void): () => void } };
const hydrated = (store: Persisted) =>
  new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) resolve();
    else store.persist.onFinishHydration(() => resolve());
  });

/** Czeka na odtworzenie „bazy” mocków z AsyncStorage; w trybie GPS urządzenia odczytuje stan zgody. */
async function mockInit() {
  await Promise.all([hydrated(useMockDb), hydrated(useSimStore)]);
  if (deviceLocation()) await syncDevicePermission();
}

export const mockServices: Services = {
  init: mockInit,
  dev: { reset: (opts) => useMockDb.getState().reset(opts) },
  permissions: mockPermissions,
  location: mockLocation,
  map: mockMap,
  scan: mockScan,
  identify: mockIdentify,
  stats: mockStats,
  feed: mockFeed,
  catalog: mockCatalog,
};

