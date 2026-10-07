/**
 * Implementacje mock wszystkich serwisów. Opóźnienia 300–1500 ms, losowość ze stałym seedem.
 * Stan symulacji (GPS, sieć, wymuszony skan) czytają z useSimStore – sterowanego z panelu /dev.
 */
import { Linking, Platform } from 'react-native';

import { mockEvidence, mockSpeciesMap } from '@/data/mock/chances';
import { BADGES, QUEST_POOL } from '@/data/mock/game';
import { buildGminaStats, GMINY, RANKINGS } from '@/data/mock/gminy';
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
  ScanPart,
  ScanResult,
  Species,
  Trip,
} from '@/types';
import { hashString, makeId, mulberry32, sleep } from '@/utils/random';
import { localYmd } from '@/utils/forecast';
import { CHANCES_TTL_MS, createTtlCache } from '@/utils/ttlCache';
import { isXxl } from '@/utils/xp';
import { isPoisonousEdibility, speciesLookalikes } from '@/utils/species';
import { fmtInt } from '@/utils/format';
import { buildOwnTripPost, claimedFindsOf } from '@/utils/tripPost';
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
  type WeatherService,
} from '../types';
import { liveCamera } from '../live/camera';
import { liveMap } from '../live/map';
import { liveWeather } from '../live/weather';
import { livePermissions, readDevicePosition, regionAt } from '../live/location';
import { buildChances, chanceSpecies, gminaForestPct } from '../chances';
import { useMockDb } from './db';
import { pickSpecies } from './identifyPick';
import { net } from './net';
import { simulatedForecast } from './weather';
import {
  designVoivodeshipMap,
  rankInVoivodeship,
  resolveGmina,
  voivodeshipGminy,
  voivodeshipRanking,
  watchTripDistance,
} from './geo';
import { mockSocial, notBlocked, settleOwnPosts, visibleCommentCount } from './social';

const sim = () => useSimStore.getState();

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

const deviceCamera = () => sim().cameraSource === 'device';

/** Tryb „aparat urządzenia”: jak lokalizacja – stan zgody systemowej odbijamy w useSimStore. */
async function syncCameraPermission() {
  sim().setPermission('camera', await liveCamera.status());
}

const SETTINGS_NAME: Record<PermissionKind, string> = { location: 'Lokalizacja', camera: 'Aparat' };

export const mockPermissions: PermissionService = {
  get: (kind) => sim().permissions[kind],
  async refresh(kind) {
    if (kind === 'camera' && deviceCamera()) await syncCameraPermission();
    if (kind === 'location' && deviceLocation()) await syncDevicePermission();
    return sim().permissions[kind];
  },
  async openSettings(kind) {
    if (kind === 'camera' && deviceCamera()) {
      const st = await liveCamera.recover().catch(() => sim().permissions.camera);
      sim().setPermission('camera', st);
      return st;
    }
    if (kind === 'location' && deviceLocation() && Platform.OS !== 'web') {
      await Linking.openSettings().catch(() => {});
      return sim().permissions.location;
    }
    const device = kind === 'camera' ? deviceCamera() : deviceLocation();
    const where = device ? 'ustawienia strony w przeglądarce' : 'symulacja: panel dev';
    useUiStore.getState().showToast(`Ustawienia › Grzybobranie › ${SETTINGS_NAME[kind]} (${where})`, 'settings');
    return sim().permissions[kind];
  },
  request: (kind) => {
    if (kind === 'camera' && deviceCamera()) {
      return liveCamera.request().then(
        (st) => {
          sim().setPermission('camera', st);
          return st;
        },
        () => sim().permissions.camera,
      );
    }
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
  // GPS urządzenia (filtrowany) albo symulowany spacer – src/services/mock/geo.ts.
  watchDistance: watchTripDistance,
};

/* ───────────────────────── Mapa okolicy ───────────────────────── */

/**
 * Prawdziwe kafle (OpenFreeMap). Przełącznik sieci z panelu dev = las bez zasięgu: mapa tylko z kafli zapisanych
 * na telefonie (obszary offline, pamięć podręczna), pobieranie obszarów offline kończy się błędem sieci.
 */
export const mockMap: MapService = {
  async getAreaMap(req, opts) {
    if (!sim().networkEnabled) {
      await sleep(250);
      return liveMap.getAreaMap(req, { ...opts, offline: true });
    }
    return liveMap.getAreaMap(req, opts);
  },
  async fetchTile(x, y, opts) {
    if (!sim().networkEnabled) {
      await sleep(150);
      throw new ServiceError('NETWORK', 'Brak połączenia – nie można pobrać mapy');
    }
    return liveMap.fetchTile(x, y, opts);
  },
};

/* ───────────────────────── Prognoza grzybowa ───────────────────────── */

/**
 * Pozycja z GPS urządzenia → Open-Meteo (src/services/live/weather.ts). Pozycja z symulacji → deterministyczna
 * prognoza bez sieci (./weather.ts; Supraśl = 4/5 i „2 dni po deszczu” z makiety). Przełącznik sieci z panelu dev
 * symuluje brak połączenia w obu trybach.
 */
export const mockWeather: WeatherService = {
  async getForecast(req, opts) {
    if (!sim().networkEnabled) {
      await sleep(300);
      throw new ServiceError('NETWORK', 'Brak połączenia – prognoza niedostępna');
    }
    if (!deviceLocation()) {
      await sleep(350);
      return simulatedForecast(req);
    }
    return liveWeather.getForecast(req, opts);
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

// Losowanie gatunku: rzadkość × sezon bieżącego miesiąca – ./identifyPick.ts.
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
    // Sezon: miesiąc skanu (0 = styczeń) – w październiku jesienne gatunki, w kwietniu smardze.
    const month = new Date().getMonth();
    if (o.speciesId) {
      species = SPECIES.find((x) => x.id === o.speciesId) ?? SPECIES[0];
    } else if (o.poisonous) {
      const poison = SPECIES.filter((x) => isPoisonousEdibility(x.edibility));
      species = pickSpecies(rnd, poison, month, { rarity: false });
    } else if (seq === 0) {
      // Pierwszy skan = scenariusz z makiety: borowik szlachetny XXL, 410 g.
      species = SPECIES[0];
    } else {
      const pool = SPECIES.filter((x) => x.edibility !== 'smiertelny' || rnd() < 0.15);
      species = pickSpecies(rnd, pool, month);
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
      lookalikes: speciesLookalikes(species),
      candidates,
    };
    return result;
  },
};

/* ───────────────────────── Statystyki ───────────────────────── */

/** Zbiory gmin (szanse) i mapy gatunków – w pamięci 10 min, jak w trybie Supabase. */
const chanceEvidence = createTtlCache<ReturnType<typeof mockEvidence>>(CHANCES_TTL_MS);
const speciesMaps = createTtlCache<ReturnType<typeof mockSpeciesMap>>(CHANCES_TTL_MS);

export const mockStats: StatsService = {
  async getGminaStats(id) {
    await net(`gmina:${id}`, 400, 900);
    // Dowolna gmina z PRG (także z rankingu innego województwa) – src/services/mock/geo.ts.
    const g = await resolveGmina(id);
    const rankIdx = RANKINGS.week.findIndex((r) => r.id === id);
    const rank = rankIdx >= 0 ? rankIdx + 1 : ((await rankInVoivodeship(g)) ?? 6 + (hashString(id) % 30));
    return buildGminaStats(g, rank);
  },
  async getRanking(period: RankingPeriod, opts) {
    const voivodeship = opts?.voivodeship;
    if (voivodeship && voivodeship !== 'podlaskie') {
      // Inne województwa: wszystkie gminy z PRG z wygenerowanymi punktami.
      await net(`ranking:${period}:${voivodeship}`, 350, 800);
      const r = await voivodeshipRanking(period, voivodeship);
      return { period, voivodeship, ...r, userContribution: useUserStore.getState().weeklyContribution };
    }
    await net(`ranking:${period}`, 350, 800);
    const seeds = RANKINGS[period];
    // Podlaskie z makiety: ranking 1:1 z pliku, mapa – wszystkie gminy z PRG (stopnie gmin gry z makiety).
    const { heat, mushroomers } = await designVoivodeshipMap(period);
    const home = simGminaId();
    heat[home] = 4;
    return {
      period,
      voivodeship: 'podlaskie',
      heat,
      mushroomers,
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
  // Szanse: zbiory gminy z 14 dni z generatora „Co tu się zbiera” (src/data/mock/chances.ts), model w telefonie.
  async getSpeciesChances(gminaId, date, opts) {
    const day = date ?? localYmd();
    const evidence = await chanceEvidence.get(`${gminaId}:${day}`, async () => {
      await net(`chances:${gminaId}`, 300, 700);
      const g = await resolveGmina(gminaId);
      return mockEvidence({ ...g, forestPct: g.forestPct ?? (await gminaForestPct(gminaId)) }, chanceSpecies(), day);
    });
    return buildChances(gminaId, evidence, day, opts);
  },
  getSpeciesMap(speciesId, voivodeship, period = 'season') {
    return speciesMaps.get(`${speciesId}:${voivodeship}:${period}`, async () => {
      await net(`species-map:${speciesId}:${voivodeship}`, 350, 800);
      return mockSpeciesMap(speciesId, voivodeship, await voivodeshipGminy(voivodeship), chanceSpecies(), localYmd(), period);
    });
  },
};


/* ───────────────────────── Feed ───────────────────────── */

function inScope(p: Post, scope: 'friends' | 'gmina') {
  // Prywatność: cudze wpisy widać dopiero od visibleFrom; własne – od razu (z adnotacją).
  const mine = p.kind === 'trip' && p.mine;
  if (!mine && new Date(p.visibleFrom).getTime() > Date.now()) return false;
  const db = useMockDb.getState();
  // Ukryte przez gracza i wpisy zablokowanych; „Znajomi” = tylko autorzy z listy znajomych (i własne wpisy).
  if (db.hiddenPostIds.includes(p.id) || !notBlocked(p)) return false;
  if (scope === 'friends') return p.scopes.includes('friends') && (mine || db.friendIds.includes(p.author.id));
  const home = simGminaId();
  return p.scopes.includes('gmina') && p.gminaId === home;
}

export const mockFeed: FeedService = {
  // Komentarze, ukrywanie wpisów i znajomi – src/services/mock/social.ts.
  ...mockSocial,
  async getFeed(scope) {
    await net(`feed:${scope}`, 500, 1200);
    settleOwnPosts();
    return useMockDb.getState().posts.filter((p) => inScope(p, scope)).map(visibleCommentCount);
  },
  async loadNewer(scope) {
    await net(`newer:${scope}`, 700, 1300);
    settleOwnPosts();
    const db = useMockDb.getState();
    const pool = refreshPool(Date.now());
    const take = db.refreshCount % 2 === 0 ? 2 : 1;
    const start = (db.refreshCount * 2) % pool.length;
    const fresh = Array.from({ length: take }, (_, i) => pool[(start + i) % pool.length]).map((p) =>
      scope === 'gmina' ? { ...p, scopes: [...new Set([...p.scopes, 'gmina' as const])], gminaId: simGminaId() } : p,
    );
    db.set({ posts: [...fresh, ...db.posts], refreshCount: db.refreshCount + 1 });
    return useMockDb.getState().posts.filter((p) => inScope(p, scope)).map(visibleCommentCount);
  },
  async publishTrip(trip: Trip, { hideRoute }) {
    await net(`publish:${trip.id}`, 800, 1400);
    const user = useUserStore.getState().user;
    const post = buildOwnTripPost({
      id: makeId('post'),
      trip,
      finds: claimedFindsOf(trip, useTripStore.getState().finds),
      author: { id: user.id, name: user.firstName, level: user.level, ringRarity: 'primary' },
      speciesName: (id) => SPECIES.find((s) => s.id === id)?.name,
      hideRoute,
      now: new Date(),
    });
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
    return QUEST_POOL;
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

/** Czeka na odtworzenie „bazy” mocków z AsyncStorage; w trybie GPS / aparatu urządzenia odczytuje stan zgód. */
async function mockInit() {
  await Promise.all([hydrated(useMockDb), hydrated(useSimStore)]);
  if (deviceLocation()) await syncDevicePermission();
  if (deviceCamera()) await syncCameraPermission();
}

export const mockServices: Services = {
  init: mockInit,
  dev: { reset: (opts) => useMockDb.getState().reset(opts) },
  permissions: mockPermissions,
  location: mockLocation,
  map: mockMap,
  weather: mockWeather,
  scan: mockScan,
  identify: mockIdentify,
  stats: mockStats,
  feed: mockFeed,
  catalog: mockCatalog,
};

