/**
 * Pętla local-first z atrapą Supabase (serwer w pamięci): gra offline → kolejka → wysłanie po kolei →
 * stan z serwera w store'ach. Atrapa realizuje kontrakt RPC w uproszczeniu (bez XP zadań i osiągnięć).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { Identification } from '@/types';

type Row = Record<string, unknown>;
type Res = { data?: unknown; error?: { message: string; code: string; details?: string } };

/** Serwer w pamięci (prefiks `mock` – dozwolony w fabrykach jest.mock). */
const mockServer = {
  online: false,
  userId: 'user-1',
  calls: [] as { fn: string; params: Row }[],
  /** Nadpisanie odpowiedzi w teście (undefined = zwykła logika). */
  override: {} as Record<string, (params: Row) => Res | undefined>,
  onGameState: null as null | (() => void),
  trips: new Map<string, Row>(),
  finds: new Map<string, Row>(),
  profile: {} as Row,
  updates: [] as Row[],
  /** Etap 4: wyzwania gmin (aktywne / zakończone), przyjęte przez gracza i obserwowane gminy. */
  challengeDefs: new Map<string, Row>(),
  accepted: new Map<string, { acceptedAt: string; completedAt: string | null }>(),
  follows: [] as string[],
  /** Etap 5: Storage w pamięci (`bucket/ścieżka` → rozmiar), pliki w telefonie (URI → bajty), pobrane zdjęcia. */
  objects: new Map<string, number>(),
  files: new Map<string, Uint8Array>(),
  downloads: [] as { url: string; findId: string }[],
  storageOverride: {} as Record<string, (bucket: string, arg: unknown) => { message: string; status?: number; statusCode?: string } | undefined>,
  reset() {
    this.online = false;
    this.userId = 'user-1';
    this.calls = [];
    this.override = {};
    this.onGameState = null;
    this.trips.clear();
    this.finds.clear();
    this.updates = [];
    this.accepted.clear();
    this.follows = [];
    this.objects = new Map();
    this.files = new Map();
    this.downloads = [];
    this.storageOverride = {};
    this.challengeDefs = new Map([
      ['ch-maslak', { id: 'ch-maslak', gminaId: 'suprasl', title: 'Znajdź maślaka', speciesId: 'maslak-zwyczajny', description: 'Opis', xp: 300, badgeId: null, badgeName: null, active: true }],
      ['ch-old', { id: 'ch-old', gminaId: 'hajnowka', title: 'Stare wyzwanie', speciesId: 'czubajka-kania', description: 'Opis', xp: 200, badgeId: null, badgeName: null, active: false }],
    ]);
    this.profile = { handle: 'grzybiarz_1a2b', displayName: 'Grzybiarz', firstName: null, homeGminaId: null, totalXp: 0, tripsCount: 0, mushroomsCount: 0 };
  },
  handle(fn: string, p: Row): Res {
    const o = this.override[fn]?.(p);
    if (o) return o;
    const now = new Date().toISOString();
    switch (fn) {
      case 'start_trip':
        if (!this.trips.has(p.p_trip_id as string)) {
          this.trips.set(p.p_trip_id as string, {
            id: p.p_trip_id, gminaId: p.p_gmina_id, status: 'active', startedAt: p.p_started_at,
            endedAt: null, durationS: null, distanceM: 0, xp: 0, hideRoute: false,
          });
        }
        return { data: this.trips.get(p.p_trip_id as string) };
      case 'submit_find': {
        const d = p.p_dimensions as Row;
        if (!this.finds.has(p.p_find_id as string)) {
          this.finds.set(p.p_find_id as string, {
            id: p.p_find_id, tripId: p.p_trip_id, speciesId: p.p_species_id, gminaId: p.p_gmina_id, rarity: p.p_rarity,
            confidence: p.p_confidence, xxl: p.p_xxl, capCm: d.cap_cm, heightCm: d.height_cm, weightG: d.weight_g,
            ageDays: d.age_days, pieces: d.pieces ?? null, collected: true, status: 'pending', foundAt: p.p_found_at, xp: 0, reward: null,
          });
        }
        return { data: this.finds.get(p.p_find_id as string) };
      }
      case 'claim_find': {
        const f = this.finds.get(p.p_find_id as string);
        if (!f) return { error: { message: 'find_not_found', code: 'P0002' } };
        if (f.status !== 'claimed') {
          const active = [...this.trips.values()].find((t) => t.status === 'active');
          const before = this.profile.totalXp as number;
          f.status = 'claimed';
          f.tripId = f.tripId ?? active?.id ?? null;
          f.xp = 40;
          f.reward = {
            xp: { lines: [{ label: 'Bazowe XP (pospolity)', xp: 40 }], total: 40 },
            levelBefore: 1, xpBefore: before, levelAfter: 1, xpAfter: before + 40,
            unlockedBadgeIds: [], unlockedAchievements: [], completedQuestIds: [], personalRecord: false,
          };
          this.profile.totalXp = before + 40;
          this.profile.mushroomsCount = (this.profile.mushroomsCount as number) + 1;
          // Przyjęte wyzwanie z tym gatunkiem – ukończone (jak claim_find na serwerze).
          this.accepted.forEach((a, id) => {
            if (!a.completedAt && this.challengeDefs.get(id)?.speciesId === f.speciesId) a.completedAt = now;
          });
          const t = this.trips.get(f.tripId as string);
          if (t) t.xp = (t.xp as number) + 40;
        }
        return { data: f.reward };
      }
      case 'discard_find': {
        const f = this.finds.get(p.p_find_id as string);
        if (f?.status === 'pending') f.status = 'discarded';
        return { data: null };
      }
      case 'report_trip_progress':
      case 'finish_trip': {
        const t = this.trips.get(p.p_trip_id as string);
        if (!t) return { error: { message: 'trip_not_found', code: 'P0002' } };
        if (t.status === 'active') {
          t.distanceM = Math.max(t.distanceM as number, p.p_distance_m as number);
          if (fn === 'finish_trip') {
            Object.assign(t, { status: 'finished', endedAt: p.p_ended_at ?? now, durationS: p.p_duration_s });
            this.profile.tripsCount = (this.profile.tripsCount as number) + 1;
          }
        }
        return { data: t };
      }
      case 'set_find_photo': {
        const f = this.finds.get(p.p_find_id as string);
        if (!f) return { error: { message: 'find_not_found', code: 'P0002' } };
        const path = p.p_path as string | null;
        if (path && !path.startsWith(`${this.userId}/`)) return { error: { message: 'invalid_path', code: 'P0001' } };
        f.photoPath = path;
        return { data: null };
      }
      case 'dev_reset_player': {
        const paths = {
          'scan-photos': [...this.finds.values()].map((f) => f.photoPath).filter(Boolean),
          'post-media': [] as string[],
          avatars: this.profile.avatarPath ? [this.profile.avatarPath] : [],
        };
        this.trips.clear();
        this.finds.clear();
        this.profile = { ...this.profile, totalXp: 0, tripsCount: 0, mushroomsCount: 0, avatarPath: null };
        const state = this.handle('get_game_state', {}).data as Row;
        return { data: { ...state, storagePaths: paths } };
      }
      case 'accept_challenge': {
        const c = this.challengeDefs.get(p.p_challenge_id as string);
        if (!c?.active) return { error: { message: 'challenge_inactive', code: 'P0001' } };
        if (!this.accepted.has(c.id as string)) this.accepted.set(c.id as string, { acceptedAt: now, completedAt: null });
        return { data: null };
      }
      case 'follow_gmina': {
        const id = p.p_gmina_id as string;
        this.follows = this.follows.filter((g) => g !== id);
        if (p.p_follow) this.follows.push(id);
        return { data: null };
      }
      case 'get_game_state': {
        this.onGameState?.();
        const today = new Date().toISOString().slice(0, 10);
        const claimed = [...this.finds.values()].filter((f) => f.status === 'claimed');
        return {
          data: {
            userId: this.userId,
            serverTime: now,
            profile: {
              ...this.profile, level: 1, xpInLevel: this.profile.totalXp, streakDays: 1, lastActiveDate: today,
              totalDistanceM: [...this.trips.values()].reduce((s, t) => s + (t.distanceM as number), 0),
            },
            atlas: [...new Set(claimed.map((f) => f.speciesId as string))].map((speciesId) => ({
              speciesId, count: claimed.filter((f) => f.speciesId === speciesId).length, firstFoundAt: now, bestCapCm: 7, bestWeightG: 70,
            })),
            badges: [],
            achievements: {},
            quests: { day: today, progress: [{ questId: 'q-scan-5', progress: claimed.length, completed: false }] },
            trips: [...this.trips.values()],
            finds: [...this.finds.values()].filter((f) => f.status !== 'discarded'),
            challenges: [...this.accepted.entries()].map(([id, a]) => {
              const { active: _active, ...c } = this.challengeDefs.get(id)!;
              return { ...c, ...a };
            }),
            followedGminy: [...this.follows],
          },
        };
      }
      default:
        return { error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
    }
  },
  /** Odpowiedź jak z postgrest-js: brak sieci = status 0 i pusty kod. */
  respond(fn: string, params: Row) {
    if (!this.online) {
      return { data: null, error: { message: 'TypeError: Network request failed', code: '', details: '' }, status: 0 };
    }
    this.calls.push({ fn, params });
    const r = this.handle(fn, params);
    return r.error ? { data: null, error: r.error, status: 400 } : { data: r.data ?? null, error: null, status: 200 };
  },
  /** Storage jak w supabase-js: `{data, error}`; brak sieci = StorageUnknownError (bez statusu). */
  bucket(bucket: string) {
    const offline = { data: null, error: { name: 'StorageUnknownError', message: 'TypeError: Network request failed' } };
    const run = <T,>(op: string, arg: unknown, ok: () => T) =>
      Promise.resolve().then(() => {
        if (!this.online) return offline;
        this.calls.push({ fn: `storage.${op}`, params: { bucket, arg } });
        const e = this.storageOverride[op]?.(bucket, arg);
        if (e) return { data: null, error: { name: 'StorageApiError', status: e.status ?? 400, statusCode: e.statusCode, message: e.message } };
        return { data: ok(), error: null };
      });
    return {
      upload: (path: string, body: ArrayBuffer, opts: Row) =>
        run('upload', { path, size: body.byteLength, contentType: opts.contentType, upsert: opts.upsert }, () => {
          this.objects.set(`${bucket}/${path}`, body.byteLength);
          return { path, id: 'obj', fullPath: `${bucket}/${path}` };
        }),
      remove: (paths: string[]) =>
        run('remove', paths, () => {
          paths.forEach((x) => this.objects.delete(`${bucket}/${x}`));
          return paths.map((name) => ({ name }));
        }),
      createSignedUrls: (paths: string[]) =>
        run('sign', paths, () =>
          paths.map((x) => ({
            path: x,
            error: this.objects.has(`${bucket}/${x}`) ? null : 'Object not found',
            signedUrl: this.objects.has(`${bucket}/${x}`) ? `http://test/storage/v1/object/sign/${bucket}/${x}?token=t` : null,
          })),
        ),
      list: (folder: string) =>
        run('list', folder, () =>
          [...this.objects.keys()]
            .filter((k) => k.startsWith(`${bucket}/${folder}/`))
            .map((k) => ({ id: k, name: k.slice(`${bucket}/${folder}/`.length) })),
        ),
    };
  },
  thenable<T>(run: () => T) {
    const p = Promise.resolve().then(run);
    return Object.assign(p, { abortSignal: () => p });
  },
  get client() {
    return {
      rpc: (fn: string, params?: Row) => this.thenable(() => this.respond(fn, params ?? {})),
      from: () => ({
        update: (values: Row) => ({
          eq: () =>
            this.thenable(() => {
              if (!this.online) return { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 };
              this.updates.push(values);
              const o = this.override['profiles.update']?.(values);
              if (o?.error) return { data: null, error: o.error, status: 409 };
              if ('avatar_path' in values) this.profile.avatarPath = values.avatar_path;
              return { data: null, error: null, status: 204 };
            }),
        }),
      }),
      storage: { from: (bucket: string) => this.bucket(bucket) },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: this.userId } } } }),
        signInAnonymously: async () => ({ data: { user: { id: this.userId } }, error: null }),
        signOut: async () => ({ error: null }),
      },
    };
  },
};

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]) }));
jest.mock('@/services/live/findPhotos', () => ({
  deleteFindPhoto: () => {},
  deleteScanViews: () => {},
  clearFindPhotos: () => {},
  resolveFindPhoto: (uri: string) => uri,
  downloadFindPhoto: async (url: string, findId: string) => {
    mockServer.downloads.push({ url, findId });
    return `file:///doc/finds/${findId}.jpg`;
  },
}));
jest.mock('@/services/live/avatarPhoto', () => ({ pruneAvatarFiles: () => {}, resolveAvatarUri: (uri: string) => uri }));
jest.mock('@/services/live/photoBytes', () => ({
  readImageBytes: async (uri: string) => mockServer.files.get(uri) ?? null,
  fetchAsDataUri: async () => null,
}));
jest.mock('../client', () => ({
  BACKEND: 'supabase',
  SUPABASE_URL: 'http://test',
  supabaseEnabled: true,
  get supabase() {
    return mockServer.client;
  },
}));

const { devResetPlayer, requestSync, startSync, stopSync } = require('../sync') as typeof import('../sync');
const game = require('../../../store/game') as typeof import('../../../store/game');
const { profilePayload } = require('../gameState') as typeof import('../gameState');
const { syncAvatar, syncProfile } = require('../profile') as typeof import('../profile');
const { resetPhotoSession, restoreFindPhotos } = require('../photos') as typeof import('../photos');
const { publishLocally } = require('../publish') as typeof import('../publish');
const { backendStatus } = require('../status') as typeof import('../status');
const { holdHydration, setOutboxEnabled, useOutboxStore } = require('../../../store/useOutboxStore') as typeof import('../../../store/useOutboxStore');
const { useCatalogStore } = require('../../../store/useCatalogStore') as typeof import('../../../store/useCatalogStore');
const { useTripStore } = require('../../../store/useTripStore') as typeof import('../../../store/useTripStore');
const { useUserStore } = require('../../../store/useUserStore') as typeof import('../../../store/useUserStore');
const { ui } = require('../../../store/useUiStore') as typeof import('../../../store/useUiStore');
const { SPECIES } = require('../../../data/mock/species') as typeof import('../../../data/mock/species');
const { GMINY } = require('../../../data/mock/gminy') as typeof import('../../../data/mock/gminy');
const { BADGES, DAILY_QUESTS } = require('../../../data/mock/game') as typeof import('../../../data/mock/game');
const { isUuid } = require('../../../utils/random') as typeof import('../../../utils/random');
/* eslint-enable @typescript-eslint/no-require-imports */

const MASLAK: Identification = {
  speciesId: 'maslak-zwyczajny',
  confidence: 0.93,
  rarity: 'pospolity',
  xxl: false,
  dimensions: { capCm: 7, heightCm: 6, weightG: 70, ageDays: 3 },
  lookalikes: [],
  candidates: [{ speciesId: 'maslak-zwyczajny', confidence: 0.93 }],
};

const outbox = () => useOutboxStore.getState();
const types = () => outbox().items.map((x) => x.type);
const fns = () => mockServer.calls.map((c) => c.fn);

/** Wyprawa z jednym odebranym maślakiem (jak „Zbieram dalej” na ekranie Nagroda). */
function playTrip(gminaId = 'suprasl') {
  const trip = game.startTrip(gminaId);
  const find = game.createPendingFind(MASLAK, gminaId, { parts: ['cap', 'underside', 'stem'] });
  game.claimFind(find.id);
  game.grantPendingRewards();
  game.addDistance(1.2);
  game.finishTrip();
  return { trip, find };
}

/** Toasty bez timera sklepu UI (Jest kończy się od razu). */
let toast: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  toast = jest.spyOn(ui, 'toast').mockImplementation(() => {});
  mockServer.reset();
  resetPhotoSession();
  setOutboxEnabled(true);
  useOutboxStore.getState().reset();
  useUserStore.getState().reset();
  useTripStore.getState().reset();
  useCatalogStore.setState({
    ready: true,
    species: SPECIES,
    speciesById: Object.fromEntries(SPECIES.map((s) => [s.id, s])),
    gminy: GMINY,
    gminaById: Object.fromEntries(GMINY.map((g) => [g.id, g])),
    badges: BADGES,
    badgeById: Object.fromEntries(BADGES.map((b) => [b.id, b])),
    dailyQuests: DAILY_QUESTS,
  });
  // Sesja jest (zapisana w telefonie), ale sieci może nie być.
  backendStatus().set({ state: 'online', userId: 'user-1', error: null });
});

afterEach(() => {
  stopSync();
  toast.mockRestore();
});

describe('synchronizacja gry (local-first)', () => {
  it('offline: gra liczy się lokalnie, zdarzenia czekają; po powrocie sieci – wysłanie po kolei i stan z serwera (nowy gracz)', async () => {
    const levelBefore = useUserStore.getState().user.level;
    const { trip, find } = playTrip();
    expect(isUuid(trip.id) && isUuid(find.id)).toBe(true);
    expect(useUserStore.getState().user.level).toBe(levelBefore); // gracz demo z mocków liczy się lokalnie
    expect(useUserStore.getState().user.tripsCount).toBe(43);
    expect(types()).toEqual(['trip.start', 'find.submit', 'find.claim', 'trip.finish']);

    const offline = await requestSync('enqueue');
    expect(offline).toMatchObject({ sent: 0, remaining: 4, hydrate: 'blocked' });
    expect(outbox().items[0]).toMatchObject({ type: 'trip.start', attempts: 1 });
    expect(outbox().items[0].lastError).toContain('Network request failed');

    mockServer.online = true;
    const r = await requestSync('manual');
    expect(r).toMatchObject({ sent: 4, dropped: 0, remaining: 0, hydrate: 'applied', mode: 'replace' });
    expect(fns()).toEqual(['start_trip', 'submit_find', 'claim_find', 'finish_trip', 'get_game_state']);
    expect(mockServer.calls[0].params).toEqual({ p_gmina_id: 'suprasl', p_trip_id: trip.id, p_started_at: trip.startedAt });
    expect(mockServer.calls[1].params).toMatchObject({
      p_find_id: find.id,
      p_trip_id: trip.id,
      p_dimensions: { cap_cm: 7, height_cm: 6, weight_g: 70, age_days: 3 },
      p_candidates: [{ species_id: 'maslak-zwyczajny', confidence: 0.93 }],
      p_parts: ['cap', 'underside', 'stem'],
    });
    expect(mockServer.calls[3].params).toMatchObject({ p_trip_id: trip.id, p_distance_m: 1200, p_track_geojson: null });

    // Pierwsze powiązanie: gracz demo (Lv 14) zastąpiony stanem z serwera.
    const u = useUserStore.getState();
    expect(u.user).toMatchObject({ id: 'user-1', name: 'Grzybiarz', handle: '@grzybiarz_1a2b', level: 1, xp: 40, tripsCount: 1, mushroomsCount: 1 });
    expect(Object.keys(u.atlas)).toEqual(['maslak-zwyczajny']);
    expect(u.badges).toEqual([]);
    const ts = useTripStore.getState();
    expect(Object.keys(ts.trips)).toEqual([trip.id]);
    expect(ts.trips[trip.id]).toMatchObject({ status: 'finished', distanceKm: 1.2, findIds: [find.id] });
    expect(ts.finds[find.id]).toMatchObject({ status: 'claimed', xp: { total: 40 } });
    expect(outbox().syncedUserId).toBe('user-1');
    expect(outbox().lastHydrateAt).not.toBeNull();
  });

  it('kolejne synchronizacje scalają: zdjęcie i ukrycie trasy z telefonu zostają, aktywna wyprawa trzyma swój czas', async () => {
    mockServer.online = true;
    playTrip();
    await requestSync('manual');
    const first = Object.keys(useTripStore.getState().trips)[0];
    game.setHideRoute(first, true);

    const trip = game.startTrip('suprasl');
    const find = game.createPendingFind(MASLAK, 'suprasl', { photoUri: 'file:///finds/m.jpg' });
    game.claimFind(find.id);
    game.grantPendingRewards();
    const r = await requestSync('enqueue');
    expect(r).toMatchObject({ hydrate: 'applied', mode: 'merge' });

    const ts = useTripStore.getState();
    expect(ts.activeTripId).toBe(trip.id);
    expect(ts.trips[trip.id]).toMatchObject({ status: 'active', segmentStartedAt: trip.segmentStartedAt, findIds: [find.id] });
    expect(ts.trips[first].hideRoute).toBe(true);
    expect(ts.finds[find.id].photoUri).toBe('file:///finds/m.jpg');
    expect(useUserStore.getState().user).toMatchObject({ xp: 80, mushroomsCount: 2 });
  });

  it('błędy trwałe wypadają do listy odrzuconych, kolejka idzie dalej; serwer jest źródłem prawdy', async () => {
    mockServer.online = true;
    mockServer.override.submit_find = () => ({
      error: { message: 'unknown_species', code: 'P0001', details: 'Gatunek nie istnieje w katalogu' },
    });
    const { find } = playTrip();
    const r = await requestSync('manual');
    expect(r).toMatchObject({ sent: 2, dropped: 2, remaining: 0, hydrate: 'applied' });
    expect(fns()).toEqual(['start_trip', 'submit_find', 'claim_find', 'finish_trip', 'get_game_state']);
    expect(outbox().failed.map((f) => [f.item.type, f.error])).toEqual([
      ['find.claim', 'find_not_found'],
      ['find.submit', 'unknown_species (Gatunek nie istnieje w katalogu)'],
    ]);
    expect(backendStatus().error).toContain('find_not_found');
    // Znaleziska nie ma na serwerze → znika też z telefonu (XP z serwera).
    expect(useTripStore.getState().finds[find.id]).toBeUndefined();
    expect(useUserStore.getState().user).toMatchObject({ level: 1, xp: 0, mushroomsCount: 0 });
  });

  it('brak sesji (28000): sesja od nowa i ponowienie w tym samym przebiegu', async () => {
    mockServer.online = true;
    let once = true;
    mockServer.override.start_trip = () => {
      if (!once) return undefined;
      once = false;
      return { error: { message: 'not_authenticated', code: '28000' } };
    };
    game.startTrip('suprasl');
    const r = await requestSync('enqueue');
    expect(r).toMatchObject({ sent: 1, dropped: 0, hydrate: 'applied' });
    expect(fns()).toEqual(['start_trip', 'start_trip', 'get_game_state']);
  });

  it('stan z serwera nie jest przyjmowany na ekranie Nagroda ani gdy w trakcie zapytania doszło zdarzenie', async () => {
    mockServer.online = true;
    const release = holdHydration();
    game.startTrip('suprasl');
    const held = await requestSync('enqueue');
    expect(held).toMatchObject({ sent: 1, hydrate: 'deferred' });
    expect(fns()).toEqual(['start_trip']);
    release();

    mockServer.onGameState = () => {
      mockServer.onGameState = null;
      useOutboxStore.getState().enqueue({ type: 'trip.progress', payload: { tripId: 'x', distanceM: 5 } }, { kick: false });
    };
    const levelBefore = useUserStore.getState().user.level;
    const skipped = await requestSync('manual');
    expect(skipped.hydrate).toBe('skipped');
    expect(useUserStore.getState().user.level).toBe(levelBefore);
    expect(outbox().syncedUserId).toBeNull();
  });

  it('nagrody czekające na „Zbieram dalej” odkładają stan z serwera', async () => {
    mockServer.online = true;
    useUserStore.getState().patch({ quests: { ...useUserStore.getState().quests, pendingRewards: ['q-rare-1'] } });
    const r = await requestSync('manual');
    expect(r.hydrate).toBe('deferred');
    game.grantPendingRewards();
    expect((await requestSync('manual')).hydrate).toBe('applied');
  });

  it('profil: najnowsza wersja do tabeli profiles; zajęty nick → komunikat i odrzucenie', async () => {
    mockServer.online = true;
    const u = useUserStore.getState();
    u.patch({ user: { ...u.user, name: 'Ola Las', firstName: 'Ola', handle: '@ola.las', avatar: { kind: 'preset', id: 'lis' } } });
    syncProfile({ name: 'Ola Las', firstName: 'Ola', handle: '@ola.las' });
    syncProfile({ homeGminaId: 'hajnowka' });
    expect(types()).toEqual(['profile.update']);
    await requestSync('manual');
    // Motyw avatara osobnym krokiem (baza bez kolumny nie blokuje nicku); zdjęcie zostaje w telefonie → null.
    expect(mockServer.updates).toEqual([
      { display_name: 'Ola Las', first_name: 'Ola', handle: 'ola.las' },
      { home_gmina_id: 'hajnowka' },
      { avatar_preset: 'lis' },
    ]);
    mockServer.updates = [];
    useUserStore.getState().patch({ user: { ...useUserStore.getState().user, avatar: { kind: 'photo', uri: 'file:///a.jpg' } } });
    syncProfile();
    await requestSync('manual');
    expect(mockServer.updates.at(-1)).toEqual({ avatar_preset: null });

    mockServer.override['profiles.update'] = (v) =>
      v.handle ? { error: { message: 'duplicate key value violates unique constraint', code: '23505' } } : undefined;
    syncProfile();
    await requestSync('manual');
    expect(outbox().failed[0]).toMatchObject({ item: { type: 'profile.update' } });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('nick jest już zajęty'), 'error');
    expect(profilePayload(useUserStore.getState().user).handle).toBe('grzybiarz_1a2b'); // serwer przywrócił swój nick
  });

  it('wyzwalacz: nowe zdarzenie wysyła się samo po krótkiej chwili (debounce)', async () => {
    mockServer.online = true;
    startSync();
    game.startTrip('suprasl');
    game.discardPendingFind('nieistniejace');
    await new Promise((r) => setTimeout(r, 700));
    expect(fns()).toEqual(['start_trip', 'get_game_state']);
    expect(outbox().items).toHaveLength(0);
  });

  it('publikacja: `trip.publish` po `trip.finish`, wpis „wysyłanie…” czeka w telefonie na feed z serwera', async () => {
    mockServer.online = true;
    mockServer.override.publish_trip = (p) => {
      const t = mockServer.trips.get(p.p_trip_id as string);
      if (!t || t.status !== 'finished') return { error: { message: 'trip_not_finished', code: 'P0001' } };
      Object.assign(t, { status: 'published', hideRoute: p.p_hide_route });
      return { data: { id: 'post-1', trip_id: t.id } };
    };
    const { trip } = playTrip();
    // Jak Podsumowanie: przełącznik trasy, potem publikacja z tym ustawieniem.
    game.setHideRoute(trip.id, true);
    const post = publishLocally(useTripStore.getState().trips[trip.id], true);
    game.markPublished(trip.id, post.id);
    expect(post).toMatchObject({ id: `local:${trip.id}`, tripId: trip.id, mine: true, routePrecision: 'gmina', mushrooms: 1, reactions: 0 });
    expect(types()).toEqual(['trip.start', 'find.submit', 'find.claim', 'trip.finish', 'trip.publish']);
    expect(outbox().localPosts.map((p) => p.id)).toEqual([post.id]);

    const r = await requestSync('manual');
    expect(r).toMatchObject({ sent: 5, dropped: 0, remaining: 0, hydrate: 'applied' });
    expect(fns()).toEqual(['start_trip', 'submit_find', 'claim_find', 'finish_trip', 'publish_trip', 'get_game_state']);
    expect(mockServer.calls[4].params).toEqual({ p_trip_id: trip.id, p_hide_route: true, p_title: 'Wyprawa po grzyby' });
    expect(useTripStore.getState().trips[trip.id]).toMatchObject({ status: 'published', postId: post.id, hideRoute: true });
    // Znika dopiero, gdy get_feed zwróci wpis tej wyprawy (src/services/supabase/feed.ts).
    expect(outbox().localPosts).toHaveLength(1);
  });

  it('publikacja odrzucona przez serwer: wpis znika z telefonu, wyprawa wraca do zakończonej, komunikat', async () => {
    mockServer.online = true;
    mockServer.override.finish_trip = () => ({ error: { message: 'trip_not_active', code: 'P0002' } });
    mockServer.override.publish_trip = () => ({ error: { message: 'trip_not_finished', code: 'P0001' } });
    const { trip } = playTrip();
    game.markPublished(trip.id, publishLocally(useTripStore.getState().trips[trip.id], false).id);
    await requestSync('manual');
    expect(outbox().failed.map((f) => f.item.type)).toEqual(['trip.publish', 'trip.finish']);
    expect(outbox().localPosts).toEqual([]);
    expect(useTripStore.getState().trips[trip.id]).toMatchObject({ status: 'finished', postId: undefined });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('nie przyjął publikacji'), 'cloud_off');
  });

  it('wyzwania i obserwowane gminy: zdarzenia w kolejce (przed odbiorem znaleziska), potem stan z serwera', async () => {
    game.toggleFollow('suprasl');
    game.toggleFollow('hajnowka');
    game.toggleFollow('hajnowka'); // rezygnacja – w kolejce czeka tylko stan docelowy
    const maslak = { id: 'ch-maslak', title: 'Znajdź maślaka', speciesId: 'maslak-zwyczajny', description: 'Opis', xp: 300 };
    expect(game.acceptChallenge('suprasl', maslak)).toBe(true);
    expect(game.acceptChallenge('suprasl', maslak)).toBe(false);
    game.acceptChallenge('hajnowka', { id: 'ch-old', title: 'Stare wyzwanie', speciesId: 'czubajka-kania', description: 'Opis', xp: 200 });
    playTrip();
    // Lokalnie od razu: wyzwanie zaliczone maślakiem z wyprawy (zadanie dnia „zrobione”).
    expect(useUserStore.getState().quests.progress['ch:ch-maslak']).toMatchObject({ completed: true });
    expect(types()).toEqual([
      'gmina.follow', 'gmina.follow', 'challenge.accept', 'challenge.accept', 'trip.start', 'find.submit', 'find.claim', 'trip.finish',
    ]);
    expect(outbox().items[1].payload).toEqual({ gminaId: 'hajnowka', follow: false });

    mockServer.online = true;
    const r = await requestSync('manual');
    expect(r).toMatchObject({ remaining: 0, dropped: 1, hydrate: 'applied' });
    expect(fns()).toEqual([
      'follow_gmina', 'follow_gmina', 'accept_challenge', 'accept_challenge',
      'start_trip', 'submit_find', 'claim_find', 'finish_trip', 'get_game_state',
    ]);
    expect(mockServer.calls[2].params).toEqual({ p_challenge_id: 'ch-maslak' });
    // Zakończone wyzwanie: odrzucone (trwały błąd) z komunikatem; serwer jest źródłem prawdy.
    expect(outbox().failed[0]).toMatchObject({ item: { type: 'challenge.accept' }, error: 'challenge_inactive' });
    expect(toast).toHaveBeenCalledWith('To wyzwanie gminy już się zakończyło', 'flag');
    const u = useUserStore.getState();
    expect(u.followedGminy).toEqual(['suprasl']);
    expect(u.challenges.map((c) => c.id)).toEqual(['ch-maslak']);
    expect(u.challenges[0].completedAt).toBeTruthy();
    expect(u.quests.progress['ch:ch-maslak']).toEqual({ questId: 'ch:ch-maslak', progress: 1, completed: true });
    expect(game.allQuests().filter((q) => q.kind === 'challenge').map((q) => q.id)).toEqual(['ch:ch-maslak']);
  });
});

/* ───────────────────────── Etap 5: zdjęcia w Storage ───────────────────────── */

/** Mały „JPEG” w telefonie (bajty czyta atrapa readImageBytes). */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const storageCall = (op: string, bucket?: string) =>
  mockServer.calls.filter((c) => c.fn === `storage.${op}` && (!bucket || c.params.bucket === bucket));

/** Wyprawa z jednym odebranym maślakiem ze zdjęciem, zakończona. */
function playPhotoTrip(photoUri: string) {
  mockServer.files.set(photoUri, JPEG);
  const trip = game.startTrip('suprasl');
  const find = game.createPendingFind(MASLAK, 'suprasl', { photoUri });
  game.claimFind(find.id);
  game.grantPendingRewards();
  game.finishTrip();
  return { trip, find };
}

/** publish_trip jak na serwerze etapu 5: idempotentne, okładka w payload.cover_path. */
function serverPublish() {
  mockServer.override.publish_trip = (p) => {
    const t = mockServer.trips.get(p.p_trip_id as string);
    if (!t || (t.status !== 'finished' && t.status !== 'published')) return { error: { message: 'trip_not_finished', code: 'P0001' } };
    Object.assign(t, { status: 'published', hideRoute: p.p_hide_route });
    return { data: { id: `post-${t.id as string}`, trip_id: t.id, payload: { cover_path: p.p_cover_path ?? null } } };
  };
}

describe('zdjęcia w Storage (etap 5)', () => {
  it('zdjęcie znaleziska: po skanie do prywatnego scan-photos, potem set_find_photo; w kolejce tylko id', async () => {
    mockServer.files.set('file:///finds/m.jpg', JPEG);
    game.startTrip('suprasl');
    const find = game.createPendingFind(MASLAK, 'suprasl', { photoUri: 'file:///finds/m.jpg' });
    game.claimFind(find.id);
    game.grantPendingRewards();
    expect(types()).toEqual(['trip.start', 'find.submit', 'photo.find', 'find.claim']);
    expect(outbox().items[2].payload).toEqual({ findId: find.id });

    mockServer.online = true;
    const r = await requestSync('manual');
    expect(r).toMatchObject({ sent: 4, dropped: 0, remaining: 0, hydrate: 'applied' });
    expect(fns()).toEqual(['start_trip', 'submit_find', 'storage.upload', 'set_find_photo', 'claim_find', 'get_game_state']);
    const path = `user-1/${find.id}.jpg`;
    expect(mockServer.calls[2].params).toEqual({
      bucket: 'scan-photos',
      arg: { path, size: JPEG.length, contentType: 'image/jpeg', upsert: true },
    });
    expect(mockServer.calls[3].params).toEqual({ p_find_id: find.id, p_path: path });
    // Stan z serwera: ścieżka z serwera, zdjęcie z telefonu.
    expect(useTripStore.getState().finds[find.id]).toMatchObject({ photoUri: 'file:///finds/m.jpg', photoPath: path });
  });

  it('błąd serwera Storage → ponowienie; 413 → zdjęcie wypada z czytelnym komunikatem, kolejka idzie dalej', async () => {
    mockServer.files.set('file:///finds/a.jpg', JPEG);
    game.startTrip('suprasl');
    const find = game.createPendingFind(MASLAK, 'suprasl', { photoUri: 'file:///finds/a.jpg' });
    mockServer.online = true;
    let mode: '503' | '413' = '503';
    mockServer.storageOverride.upload = () =>
      mode === '503'
        ? { message: 'Service Unavailable', status: 503 }
        : { message: 'The object exceeded the maximum allowed size', status: 400, statusCode: '413' };

    const first = await requestSync('manual');
    expect(first).toMatchObject({ sent: 2, hydrate: 'blocked' });
    expect(outbox().items[0]).toMatchObject({ type: 'photo.find', attempts: 1 });

    mode = '413';
    game.claimFind(find.id);
    game.grantPendingRewards();
    const second = await requestSync('manual');
    expect(second).toMatchObject({ dropped: 1, remaining: 0, hydrate: 'applied' });
    expect(outbox().failed[0]).toMatchObject({
      item: { type: 'photo.find' },
      error: expect.stringContaining('zdjęcie za duże dla serwera (413)'),
    });
    expect(backendStatus().error).toContain('zdjęcie znaleziska');
    expect(fns()).not.toContain('set_find_photo');
    expect(useTripStore.getState().finds[find.id]).toMatchObject({ status: 'claimed', photoUri: 'file:///finds/a.jpg' });
    expect(useTripStore.getState().finds[find.id].photoPath).toBeUndefined();
  });

  it('set_find_photo odrzucone (find_not_found) → zdarzenie wypada, wysłany plik znika ze Storage', async () => {
    mockServer.online = true;
    mockServer.override.set_find_photo = () => ({ error: { message: 'find_not_found', code: 'P0002' } });
    mockServer.files.set('file:///finds/n.jpg', JPEG);
    game.startTrip('suprasl');
    game.createPendingFind(MASLAK, 'suprasl', { photoUri: 'file:///finds/n.jpg' });
    const r = await requestSync('manual');
    expect(r).toMatchObject({ dropped: 1, remaining: 0 });
    expect(outbox().failed[0]).toMatchObject({ item: { type: 'photo.find' }, error: 'find_not_found' });
    expect(storageCall('remove', 'scan-photos')).toHaveLength(1);
    expect(mockServer.objects.size).toBe(0);
  });

  it('brak pliku zdjęcia przy wysyłce (np. wygasły blob: na webie) → nic do wysłania, bez błędu', async () => {
    mockServer.online = true;
    game.startTrip('suprasl');
    game.createPendingFind(MASLAK, 'suprasl', { photoUri: 'blob:http://localhost:8081/x' });
    const r = await requestSync('manual');
    expect(r).toMatchObject({ sent: 3, dropped: 0, remaining: 0, hydrate: 'applied' });
    expect(fns()).toEqual(['start_trip', 'submit_find', 'get_game_state']);
  });

  it('porzucone znalezisko: czekające zdjęcie znika z kolejki, wysłane – usuwane ze Storage (photo.delete)', async () => {
    mockServer.files.set('file:///finds/x.jpg', JPEG);
    game.startTrip('suprasl');
    const a = game.createPendingFind(MASLAK, 'suprasl', { photoUri: 'file:///finds/x.jpg' });
    game.discardPendingFind(a.id);
    expect(types()).toEqual(['trip.start']);

    mockServer.online = true;
    const b = game.createPendingFind(MASLAK, 'suprasl', { photoUri: 'file:///finds/x.jpg' });
    await requestSync('manual');
    const path = `user-1/${b.id}.jpg`;
    expect(mockServer.objects.has(`scan-photos/${path}`)).toBe(true);
    expect(useTripStore.getState().finds[b.id].photoPath).toBe(path);

    game.discardPendingFind(b.id);
    expect(types()).toEqual(['find.discard', 'photo.delete']);
    expect(outbox().items[1].payload).toEqual({ bucket: 'scan-photos', paths: [path] });
    const r = await requestSync('manual');
    expect(r).toMatchObject({ sent: 2, dropped: 0, remaining: 0 });
    expect(storageCall('remove', 'scan-photos').map((c) => c.params.arg)).toEqual([[path]]);
    expect(mockServer.objects.size).toBe(0);
  });

  it('publikacja: okładka (najlepsze zdjęcie) do publicznego post-media tuż przed publish_trip; bez zdjęcia – bez okładki', async () => {
    mockServer.online = true;
    serverPublish();
    const { trip } = playPhotoTrip('file:///finds/c.jpg');
    publishLocally(useTripStore.getState().trips[trip.id], false);
    expect(outbox().items.at(-1)?.payload).toEqual({ tripId: trip.id, hideRoute: false, title: 'Wyprawa po grzyby' });
    await requestSync('manual');
    const i = fns().indexOf('publish_trip');
    const cover = mockServer.calls[i].params.p_cover_path as string;
    expect(cover).toMatch(new RegExp(`^user-1/${trip.id}-[0-9a-f]{8}\\.jpg$`));
    expect(mockServer.calls[i - 1]).toMatchObject({ fn: 'storage.upload', params: { bucket: 'post-media', arg: { path: cover } } });
    expect(mockServer.objects.has(`post-media/${cover}`)).toBe(true);
    expect(mockServer.calls[i].params).toEqual({ p_trip_id: trip.id, p_hide_route: false, p_title: 'Wyprawa po grzyby', p_cover_path: cover });

    // Wyprawa bez zdjęć – publish_trip bez p_cover_path (jak dotąd).
    const t2 = game.startTrip('suprasl');
    const f2 = game.createPendingFind(MASLAK, 'suprasl');
    game.claimFind(f2.id);
    game.grantPendingRewards();
    game.finishTrip();
    publishLocally(useTripStore.getState().trips[t2.id], true);
    await requestSync('manual');
    expect(mockServer.calls.filter((c) => c.fn === 'publish_trip').at(-1)?.params).toEqual({
      p_trip_id: t2.id,
      p_hide_route: true,
      p_title: 'Wyprawa po grzyby',
    });
    expect(storageCall('upload', 'post-media')).toHaveLength(1);
  });

  it('okładka: błąd sieci → ponowienie z tą samą ścieżką; 415 → publikacja bez okładki', async () => {
    mockServer.online = true;
    serverPublish();
    const { trip } = playPhotoTrip('file:///finds/d.jpg');
    publishLocally(useTripStore.getState().trips[trip.id], false);
    let mode: 'offline' | '415' = 'offline';
    mockServer.storageOverride.upload = (bucket) =>
      bucket !== 'post-media'
        ? undefined
        : mode === 'offline'
          ? { message: 'Gateway Timeout', status: 504 }
          : { message: 'mime type image/gif is not supported', status: 400, statusCode: '415' };
    const first = await requestSync('manual');
    expect(first.hydrate).toBe('blocked');
    expect(outbox().items).toHaveLength(1);
    expect(outbox().items[0]).toMatchObject({ type: 'trip.publish', attempts: 1 });
    expect(fns()).not.toContain('publish_trip');

    mode = '415';
    const second = await requestSync('manual');
    expect(second).toMatchObject({ sent: 1, dropped: 0, remaining: 0 });
    const paths = storageCall('upload', 'post-media').map((c) => (c.params.arg as Row).path);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(1); // ponowienie – ta sama ścieżka (nonce z id zdarzenia)
    expect(mockServer.calls.find((c) => c.fn === 'publish_trip')?.params).toEqual({
      p_trip_id: trip.id,
      p_hide_route: false,
      p_title: 'Wyprawa po grzyby',
    });
    expect(useTripStore.getState().trips[trip.id].status).toBe('published');
  });

  it('zdjęcie profilowe: avatars + avatar_path (w kolejce najnowsze), stare pliki sprzątane; motyw → avatar_path null', async () => {
    mockServer.online = true;
    mockServer.objects.set('avatars/user-1/avatar-1.jpg', 10); // poprzednie zdjęcie gracza
    mockServer.files.set('file:///avatars/me.jpg', JPEG);
    const u = useUserStore.getState();
    u.patch({ user: { ...u.user, avatar: { kind: 'photo', uri: 'file:///avatars/me.jpg' } } });
    syncAvatar(1_700_000_000_000);
    syncAvatar(1_700_000_000_500);
    expect(types()).toEqual(['photo.avatar']);
    expect(outbox().items[0].payload).toEqual({ photo: true, ts: 1_700_000_000_500 });

    await requestSync('manual');
    const path = 'user-1/avatar-1700000000500.jpg';
    expect(storageCall('upload', 'avatars').map((c) => (c.params.arg as Row).path)).toEqual([path]);
    expect(mockServer.updates).toContainEqual({ avatar_path: path });
    expect([...mockServer.objects.keys()]).toEqual([`avatars/${path}`]);
    expect(useUserStore.getState().user.avatar).toEqual({ kind: 'photo', uri: 'file:///avatars/me.jpg', path });

    const u2 = useUserStore.getState();
    u2.patch({ user: { ...u2.user, avatar: { kind: 'preset', id: 'lis' } } });
    syncProfile();
    syncAvatar();
    await requestSync('manual');
    expect(mockServer.updates.slice(-2)).toEqual([{ avatar_preset: 'lis' }, { avatar_path: null }]);
    expect(mockServer.objects.size).toBe(0);
    expect(useUserStore.getState().user.avatar).toEqual({ kind: 'preset', id: 'lis' });
  });

  it('nowe urządzenie: zdjęcia znalezisk z serwera pobierane do telefonu (bez ponownej wysyłki), avatar z serwera', async () => {
    mockServer.online = true;
    const now = new Date().toISOString();
    mockServer.trips.set('t-old', {
      id: 't-old', gminaId: 'suprasl', status: 'finished', startedAt: now, endedAt: now, durationS: 600, distanceM: 1500, xp: 40, hideRoute: false,
    });
    mockServer.finds.set('f-old', {
      id: 'f-old', tripId: 't-old', speciesId: 'maslak-zwyczajny', gminaId: 'suprasl', rarity: 'pospolity', confidence: 0.93, xxl: false,
      capCm: 7, heightCm: 6, weightG: 70, ageDays: 3, pieces: null, collected: true, status: 'claimed', foundAt: now, xp: 40, reward: null,
      photoPath: 'user-1/f-old.jpg',
    });
    mockServer.objects.set('scan-photos/user-1/f-old.jpg', 10);
    mockServer.profile.avatarPath = 'user-1/avatar-5.jpg';
    expect(useUserStore.getState().user.avatar).toBeUndefined();

    await requestSync('manual');
    await restoreFindPhotos();
    expect(mockServer.downloads).toEqual([
      { url: expect.stringContaining('/object/sign/scan-photos/user-1/f-old.jpg'), findId: 'f-old' },
    ]);
    expect(useTripStore.getState().finds['f-old']).toMatchObject({ photoPath: 'user-1/f-old.jpg', photoUri: 'file:///doc/finds/f-old.jpg' });
    expect(useUserStore.getState().user.avatar).toEqual({
      kind: 'photo',
      uri: expect.stringMatching(/\/storage\/v1\/object\/public\/avatars\/user-1\/avatar-5\.jpg$/),
      path: 'user-1/avatar-5.jpg',
    });

    // Kolejne synchronizacje: zdjęcia już są – bez pobierania i bez wysyłki.
    await requestSync('manual');
    await restoreFindPhotos();
    expect(mockServer.downloads).toHaveLength(1);
    expect(storageCall('upload')).toHaveLength(0);
  });

  it('„Nowy gracz (reset na serwerze)”: pliki z dev_reset_player().storagePaths usunięte ze Storage', async () => {
    mockServer.online = true;
    mockServer.finds.set('f1', { id: 'f1', status: 'claimed', photoPath: 'user-1/f1.jpg' });
    mockServer.objects.set('scan-photos/user-1/f1.jpg', 10);
    mockServer.objects.set('avatars/user-1/avatar-1.jpg', 10);
    mockServer.profile.avatarPath = 'user-1/avatar-1.jpg';
    const r = await devResetPlayer();
    expect(r.ok).toBe(true);
    expect(r.message).toContain('usunięto zdjęć z serwera: 2');
    expect(mockServer.objects.size).toBe(0);
  });
});
