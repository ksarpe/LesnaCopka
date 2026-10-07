import { describe, expect, it, jest } from '@jest/globals';

import { GMINY } from '@/data/mock/gminy';
import { initialUserState, todayKey } from '@/store/useUserStore';
import type { Find, Gmina, Trip } from '@/types';
import {
  buildImportState,
  buildUserState,
  deriveCounters,
  effectiveStreak,
  mapAcceptedChallenges,
  mapFind,
  mapReward,
  mapTrip,
  mergeAvatar,
  mergeTripsAndFinds,
  needsAvatarBackfill,
  parseGameState,
  profilePayload,
  type ServerChallenge,
  type ServerFind,
  type ServerGameState,
  type ServerTrip,
} from '../gameState';
import { classifyError, RATE_LIMIT_DEFER_MS, retryAfterMs, rpcFor } from '../syncRpc';
import { deferUntil, makeItem } from '@/store/useOutboxStore';

// jest.mock jest wynoszony nad importy (babel-jest): AsyncStorage z pamięci, bez indeksu gmin PRG.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]) }));
/* eslint-enable @typescript-eslint/no-require-imports */

const NOW = new Date(2026, 9, 6, 15, 0).getTime();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000).toISOString();
const TODAY = todayKey(new Date(NOW));
const YESTERDAY = todayKey(new Date(NOW - 86400000));
const gminaById: Record<string, Gmina> = Object.fromEntries(GMINY.map((g) => [g.id, g]));

const REWARD = {
  xp: { lines: [{ label: 'Bazowe XP (rzadki)', xp: 120 }, { label: 'Nowy gatunek w atlasie', xp: 50 }], total: 170 },
  levelBefore: 1,
  xpBefore: 0,
  levelAfter: 1,
  xpAfter: 170,
  unlockedBadgeIds: [],
  unlockedAchievements: [{ id: 'kolekcjoner', tier: 1, xp: 50 }],
  completedQuestIds: ['q-rare-1'],
  completedChallengeIds: [],
  personalRecord: false,
};

const sTrip = (p: Partial<ServerTrip> & { id: string }): ServerTrip => ({
  gminaId: 'suprasl',
  status: 'finished',
  startedAt: iso(120),
  endedAt: iso(60),
  durationS: 3600,
  distanceM: 2500,
  xp: 170,
  hideRoute: false,
  ...p,
});

const sFind = (p: Partial<ServerFind> & { id: string }): ServerFind => ({
  tripId: 'trip-a',
  speciesId: 'borowik-szlachetny',
  gminaId: 'suprasl',
  rarity: 'rzadki',
  confidence: 0.94,
  xxl: false,
  capCm: 12,
  heightCm: 14,
  weightG: 300,
  ageDays: 4,
  pieces: null,
  collected: true,
  status: 'claimed',
  foundAt: iso(90),
  xp: 170,
  reward: REWARD,
  ...p,
});

const state = (p: Partial<ServerGameState> = {}): ServerGameState => ({
  userId: 'user-1',
  serverTime: iso(0),
  profile: {
    handle: 'grzybiarz_1a2b',
    displayName: 'Grzybiarz',
    firstName: null,
    homeGminaId: null,
    totalXp: 170,
    level: 1,
    xpInLevel: 170,
    streakDays: 1,
    lastActiveDate: TODAY,
    tripsCount: 1,
    mushroomsCount: 1,
    totalDistanceM: 2500,
  },
  atlas: [{ speciesId: 'borowik-szlachetny', count: 1, firstFoundAt: iso(90), bestCapCm: 12, bestWeightG: 300 }],
  badges: ['ranny-ptaszek'],
  achievements: { kolekcjoner: 1 },
  quests: {
    day: TODAY,
    progress: [
      { questId: 'q-scan-5', progress: 1, completed: false },
      { questId: 'q-rare-1', progress: 1, completed: true },
      { questId: 'q-km-5', progress: 2.5, completed: false },
    ],
    // Serwer sprzed progresji (stała lista zadań dnia, bez tygodniowych) – testy progresji podają je jawnie.
    daily: null,
    week: null,
    weekly: null,
  },
  counters: null,
  trips: [sTrip({ id: 'trip-a' })],
  finds: [sFind({ id: 'find-a' })],
  // Serwer sprzed etapu 4 (bez wyzwań i obserwowanych) – testy etapu 4 podają je jawnie.
  challenges: null,
  followedGminy: null,
  ...p,
});

const localTrip = (p: Partial<Trip> & { id: string }): Trip => ({
  gminaId: 'suprasl',
  status: 'finished',
  startedAt: iso(120),
  endedAt: iso(60),
  elapsedMs: 3600_000,
  segmentStartedAt: NOW - 3600_000,
  distanceKm: 2.5,
  findIds: [],
  xp: 0,
  hideRoute: false,
  ...p,
});

const localFind = (p: Partial<Find> & { id: string }): Find => ({
  tripId: 'trip-a',
  speciesId: 'borowik-szlachetny',
  gminaId: 'suprasl',
  rarity: 'rzadki',
  confidence: 0.94,
  xxl: false,
  dimensions: { capCm: 12, heightCm: 14, weightG: 300, ageDays: 4 },
  collected: true,
  status: 'claimed',
  foundAt: iso(90),
  ...p,
});

describe('parseGameState', () => {
  it('przyjmuje odpowiedź serwera (liczby jako tekst, brakujące pola → wartości domyślne)', () => {
    const s = parseGameState({
      userId: 'user-1',
      serverTime: '2026-10-07T08:15:00.000Z',
      profile: { handle: 'ola', displayName: 'Ola', level: '3', xpInLevel: '120', lastActiveDate: '2026-10-06', totalDistanceM: '2500' },
      atlas: [{ speciesId: 'borowik-szlachetny', count: 2, bestCapCm: '12.5', bestWeightG: 300 }, { count: 1 }],
      achievements: { kolekcjoner: 2, inne: 0 },
      quests: { day: '2026-10-06', progress: [{ questId: 'q-km-5', progress: '1.3', completed: false }] },
      trips: [{ id: 't', gminaId: 'suprasl', status: 'active', startedAt: iso(10), endedAt: null, durationS: null, distanceM: 10 }],
      finds: [{ id: 'f', tripId: null, speciesId: 'x', gminaId: 'y', rarity: 'epicki', status: 'pending', capCm: null, pieces: 12 }],
    });
    expect(s.profile).toMatchObject({ level: 3, xpInLevel: 120, firstName: null, homeGminaId: null, totalDistanceM: 2500 });
    expect(s.atlas).toEqual([{ speciesId: 'borowik-szlachetny', count: 2, firstFoundAt: '', bestCapCm: 12.5, bestWeightG: 300 }]);
    expect(s.achievements).toEqual({ kolekcjoner: 2 });
    expect(s.badges).toEqual([]);
    expect(s.quests.progress[0]).toEqual({ questId: 'q-km-5', progress: 1.3, completed: false });
    expect(s.trips[0]).toMatchObject({ status: 'active', endedAt: null, durationS: null, hideRoute: false });
    expect(s.finds[0]).toMatchObject({ tripId: null, rarity: 'epicki', status: 'pending', capCm: null, pieces: 12, collected: true });
    // Serwer sprzed etapu 4: bez wyzwań i obserwowanych gmin → null (zostają lokalne).
    expect(s.challenges).toBeNull();
    expect(s.followedGminy).toBeNull();
  });

  it('etap 4: przyjęte wyzwania (odznaka opcjonalna) i obserwowane gminy bez duplikatów', () => {
    const s = parseGameState({
      userId: 'user-1',
      profile: { handle: 'ola' },
      challenges: [
        {
          id: 'ch-1', gminaId: 'suprasl', title: 'Znajdź szmaciaka', speciesId: 'szmaciak-galezisty', description: 'Opis',
          xp: '500', badgeId: 'lowca-legend', badgeName: 'Łowca Legend', acceptedAt: iso(60), completedAt: null,
        },
        {
          id: 'ch-2', gminaId: 'hajnowka', title: 'Kania', speciesId: 'czubajka-kania', xp: 300, badgeId: null, acceptedAt: iso(30),
          completedAt: iso(5), endsAt: iso(-60),
        },
        { id: '', gminaId: 'x' },
        'śmieć',
      ],
      followedGminy: ['suprasl', 'hajnowka', 'suprasl', 7, ''],
    });
    expect(s.challenges).toEqual([
      {
        id: 'ch-1', gminaId: 'suprasl', title: 'Znajdź szmaciaka', speciesId: 'szmaciak-galezisty', description: 'Opis',
        xp: 500, badgeId: 'lowca-legend', badgeName: 'Łowca Legend', acceptedAt: iso(60), completedAt: null, endsAt: null,
      },
      {
        id: 'ch-2', gminaId: 'hajnowka', title: 'Kania', speciesId: 'czubajka-kania', description: '',
        xp: 300, badgeId: null, badgeName: null, acceptedAt: iso(30), completedAt: iso(5), endsAt: iso(-60),
      },
    ]);
    expect(s.followedGminy).toEqual(['suprasl', 'hajnowka']);
  });

  it('bez profilu albo identyfikatora gracza – błąd', () => {
    expect(() => parseGameState({ userId: 'x' })).toThrow('Nieprawidłowy stan gry');
    expect(() => parseGameState(null)).toThrow();
  });
});

describe('etap 5: zdjęcia w Storage', () => {
  it('parseGameState: profile.avatarPath i finds[].photoPath; brak pola (stary serwer) → undefined', () => {
    const s = parseGameState({
      userId: 'user-1',
      profile: { handle: 'ola', avatarPath: 'user-1/avatar-1.jpg' },
      finds: [
        { id: 'a', status: 'claimed', photoPath: 'user-1/a.jpg' },
        { id: 'b', status: 'claimed', photoPath: null },
        { id: 'c', status: 'claimed' },
      ],
    });
    expect(s.profile.avatarPath).toBe('user-1/avatar-1.jpg');
    expect(s.finds.map((f) => f.photoPath)).toEqual(['user-1/a.jpg', null, undefined]);
    expect(s.finds[2]).not.toHaveProperty('photoPath');
    expect(parseGameState({ userId: 'u', profile: {} }).profile).not.toHaveProperty('avatarPath');
  });

  it('mapFind: ścieżka zdjęcia z serwera (stary serwer – z telefonu); znacznik sb-photo: innej ścieżki znika', () => {
    expect(mapFind(sFind({ id: 'f', photoPath: 'user-1/f.jpg' }))).toMatchObject({ photoPath: 'user-1/f.jpg' });
    expect(mapFind(sFind({ id: 'f', photoPath: 'user-1/f.jpg' })).photoUri).toBeUndefined(); // do pobrania (photos.ts)
    const local = localFind({ id: 'f', photoUri: 'file:///finds/f.jpg', photoPath: 'user-1/f.jpg' });
    expect(mapFind(sFind({ id: 'f', photoPath: null }), local)).not.toHaveProperty('photoPath');
    expect(mapFind(sFind({ id: 'f', photoPath: null }), local).photoUri).toBe('file:///finds/f.jpg');
    expect(mapFind(sFind({ id: 'f' }), local)).toMatchObject({ photoPath: 'user-1/f.jpg', photoUri: 'file:///finds/f.jpg' });
    const marker = localFind({ id: 'f', photoUri: 'sb-photo:user-1/f.jpg', photoPath: 'user-1/f.jpg' });
    expect(mapFind(sFind({ id: 'f', photoPath: 'user-1/f.jpg' }), marker).photoUri).toBe('sb-photo:user-1/f.jpg');
    expect(mapFind(sFind({ id: 'f', photoPath: null }), marker)).not.toHaveProperty('photoUri');
  });

  it('avatar: z serwera, gdy w telefonie go nie ma albo zmienił się na innym urządzeniu; niewysłane zdjęcie zostaje', () => {
    const p = (avatarPath: string | null | undefined) => ({ ...state().profile, ...(avatarPath !== undefined ? { avatarPath } : {}) });
    const fromServer = mergeAvatar(undefined, p('user-1/avatar-2.jpg'), 'user-1');
    expect(fromServer).toEqual({
      kind: 'photo',
      uri: expect.stringMatching(/\/storage\/v1\/object\/public\/avatars\/user-1\/avatar-2\.jpg$/),
      path: 'user-1/avatar-2.jpg',
    });
    expect(mergeAvatar(undefined, { ...p(null), avatarPreset: 'sowa' }, 'user-1')).toEqual({ kind: 'preset', id: 'sowa' });
    expect(mergeAvatar(undefined, p(null), 'user-1')).toBeUndefined();
    const synced = { kind: 'photo' as const, uri: 'file:///avatars/a.jpg', path: 'user-1/avatar-1.jpg' };
    expect(mergeAvatar(synced, p('user-1/avatar-1.jpg'), 'user-1')).toBe(synced);
    expect(mergeAvatar(synced, p('user-1/avatar-2.jpg'), 'user-1')).toMatchObject({ path: 'user-1/avatar-2.jpg' });
    expect(mergeAvatar(synced, p(null), 'user-1')).toBeUndefined();
    // Zdjęcie jeszcze niewysłane albo z innego konta („Nowe konto”) – zostaje; stary serwer – bez zmian.
    const unsent = { kind: 'photo' as const, uri: 'file:///avatars/b.jpg' };
    expect(mergeAvatar(unsent, p('user-1/avatar-2.jpg'), 'user-1')).toBe(unsent);
    expect(mergeAvatar(synced, p(null), 'user-2')).toBe(synced);
    expect(mergeAvatar(undefined, p(undefined), 'user-1')).toBeUndefined();
    const preset = { kind: 'preset' as const, id: 'lis' };
    expect(mergeAvatar(preset, p('user-1/avatar-2.jpg'), 'user-1')).toBe(preset);
    // buildUserState: nowe urządzenie (gracz demo bez avatara) dostaje zdjęcie z serwera.
    const out = buildUserState(state({ profile: p('user-1/avatar-2.jpg') }), initialUserState(), 'replace', {
      now: NOW,
      gminaById,
      finds: [],
      trips: [],
    });
    expect(out.user?.avatar).toMatchObject({ kind: 'photo', path: 'user-1/avatar-2.jpg' });
  });

  it('dosłanie zdjęcia profilowego: tylko gdy serwer nie ma żadnego, a lokalne nie jest wysłane z tego konta', () => {
    const unsent = { kind: 'photo' as const, uri: 'file:///avatars/b.jpg' };
    expect(needsAvatarBackfill(unsent, null, 'user-1')).toBe(true);
    expect(needsAvatarBackfill({ ...unsent, path: 'user-2/avatar-1.jpg' }, null, 'user-1')).toBe(true);
    expect(needsAvatarBackfill({ ...unsent, path: 'user-1/avatar-1.jpg' }, null, 'user-1')).toBe(false);
    expect(needsAvatarBackfill(unsent, 'user-1/avatar-9.jpg', 'user-1')).toBe(false);
    expect(needsAvatarBackfill(unsent, undefined, 'user-1')).toBe(false);
    expect(needsAvatarBackfill({ kind: 'preset', id: 'lis' }, null, 'user-1')).toBe(false);
  });
});

describe('mapowanie znalezisk i wypraw', () => {
  it('rozpiska z claim_find → Find.xp i Find.reward (z osiągnięciami)', () => {
    const { xp, reward } = mapReward(REWARD);
    expect(xp?.total).toBe(170);
    expect(reward).toEqual({
      levelBefore: 1,
      xpBefore: 0,
      levelAfter: 1,
      xpAfter: 170,
      unlockedBadgeIds: [],
      unlockedAchievements: [{ id: 'kolekcjoner', tier: 1, xp: 50 }],
      completedQuestIds: ['q-rare-1'],
      personalRecord: false,
    });
    expect(mapReward(null)).toEqual({});
  });

  it('znalezisko z serwera zachowuje lokalne zdjęcie i alternatywy; kępka ma liczbę sztuk', () => {
    const local = localFind({ id: 'f', photoUri: 'file:///finds/a.jpg', candidates: [{ speciesId: 'x', confidence: 0.4 }] });
    const f = mapFind(sFind({ id: 'f', pieces: 12 }), local);
    expect(f).toMatchObject({
      status: 'claimed',
      photoUri: 'file:///finds/a.jpg',
      candidates: [{ speciesId: 'x', confidence: 0.4 }],
      dimensions: { capCm: 12, heightCm: 14, weightG: 300, ageDays: 4, pieces: 12 },
      xp: { total: 170 },
      reward: { levelAfter: 1, xpAfter: 170 },
    });
    const pending = mapFind(sFind({ id: 'p', status: 'pending', reward: null, xp: 0, tripId: null }));
    expect(pending.xp).toBeUndefined();
    expect(pending.reward).toBeUndefined();
    expect(pending.tripId).toBeNull();
  });

  it('zakończona wyprawa: czas z durationS, dystans w km; ukrycie trasy i publikacja zostają z telefonu', () => {
    const t = mapTrip(sTrip({ id: 'a', xp: 170 }), ['f'], localTrip({ id: 'a', status: 'published', postId: 'p1', hideRoute: true, xp: 250 }), NOW);
    // Lokalnie opublikowana (feed = mock) – telefon jest „dalej”, zostaje przy swoim.
    expect(t).toMatchObject({ status: 'published', postId: 'p1', hideRoute: true, findIds: ['f'] });
    const t2 = mapTrip(sTrip({ id: 'a', durationS: 1800, distanceM: 3200, xp: 170 }), [], localTrip({ id: 'a', hideRoute: true, xp: 250 }), NOW);
    expect(t2).toMatchObject({ status: 'finished', elapsedMs: 1800_000, distanceKm: 3.2, hideRoute: true, xp: 250 });
    expect(mapTrip(sTrip({ id: 'a', durationS: null }), [], undefined, NOW).elapsedMs).toBe(3600_000);
  });

  it('trwająca wyprawa: czas i większy dystans z telefonu; nowa z serwera liczy czas od startu', () => {
    const local = localTrip({ id: 'a', status: 'active', elapsedMs: 5000, segmentStartedAt: NOW - 1000, distanceKm: 1.4, endedAt: undefined });
    const t = mapTrip(sTrip({ id: 'a', status: 'active', endedAt: null, durationS: null, distanceM: 1200 }), [], local, NOW);
    expect(t).toMatchObject({ status: 'active', elapsedMs: 5000, segmentStartedAt: NOW - 1000, distanceKm: 1.4 });
    const fresh = mapTrip(sTrip({ id: 'b', status: 'active', startedAt: iso(30), endedAt: null, durationS: null }), [], undefined, NOW);
    expect(fresh).toMatchObject({ elapsedMs: 0, segmentStartedAt: NOW - 30 * 60000 });
  });

  it('wyprawa zakończona w telefonie, a na serwerze wciąż aktywna – nie wraca jako trwająca', () => {
    const t = mapTrip(sTrip({ id: 'a', status: 'active', endedAt: null }), [], localTrip({ id: 'a' }), NOW);
    expect(t.status).toBe('finished');
  });
});

describe('mergeTripsAndFinds', () => {
  const local = {
    trips: {
      demo: localTrip({ id: 'demo', startedAt: iso(60 * 24 * 30), findIds: ['demo-f'] }),
      'trip-a': localTrip({ id: 'trip-a', hideRoute: true, findIds: ['find-a'] }),
      newer: localTrip({ id: 'newer', startedAt: iso(30) }),
    },
    finds: {
      'demo-f': localFind({ id: 'demo-f', tripId: 'demo', foundAt: iso(60 * 24 * 30) }),
      'find-a': localFind({ id: 'find-a', photoUri: 'file:///a.jpg' }),
      scan: localFind({ id: 'scan', status: 'pending', tripId: null, foundAt: iso(1) }),
      lost: localFind({ id: 'lost', tripId: 'newer', foundAt: iso(20) }),
    },
    activeTripId: null,
  };

  it('pierwsze powiązanie (replace): tylko serwer + oczekujący skan; zdjęcie zostaje', () => {
    const m = mergeTripsAndFinds(local, state(), 'replace', NOW);
    expect(Object.keys(m.trips)).toEqual(['trip-a']);
    expect(Object.keys(m.finds).sort()).toEqual(['find-a', 'scan']);
    expect(m.finds['find-a'].photoUri).toBe('file:///a.jpg');
    expect(m.trips['trip-a']).toMatchObject({ findIds: ['find-a'], hideRoute: true });
    expect(m.activeTripId).toBeNull();
  });

  it('kolejne (merge): starsze lokalne wyprawy spoza okna serwera zostają, nowsze nieznane serwerowi znikają', () => {
    const m = mergeTripsAndFinds(local, state(), 'merge', NOW);
    expect(Object.keys(m.trips).sort()).toEqual(['demo', 'trip-a']);
    expect(Object.keys(m.finds).sort()).toEqual(['demo-f', 'find-a', 'scan']);
    expect(m.trips.demo.findIds).toEqual(['demo-f']);
  });

  it('serwer bez wypraw – lokalne (nigdy nie wysłane) znikają', () => {
    const m = mergeTripsAndFinds(local, state({ trips: [], finds: [] }), 'merge', NOW);
    expect(Object.keys(m.trips)).toEqual([]);
    expect(Object.keys(m.finds)).toEqual(['scan']);
  });

  it('aktywna wyprawa z serwera ustawia activeTripId; oczekujące znaleziska bez wyprawy przechodzą', () => {
    const m = mergeTripsAndFinds(
      { trips: {}, finds: {}, activeTripId: null },
      state({
        trips: [sTrip({ id: 'live', status: 'active', startedAt: iso(10), endedAt: null, durationS: null }), sTrip({ id: 'trip-a' })],
        finds: [sFind({ id: 'find-a' }), sFind({ id: 'p', status: 'pending', tripId: null, reward: null })],
      }),
      'merge',
      NOW,
    );
    expect(m.activeTripId).toBe('live');
    expect(m.finds.p.status).toBe('pending');
    expect(m.trips.live.findIds).toEqual([]);
  });
});

describe('buildUserState', () => {
  const local = initialUserState();
  const ctx = (finds: Find[] = [], trips: Trip[] = []) => ({ now: NOW, gminaById, distanceQuestId: 'q-km-5', finds, trips });

  it('seria dni przerwana, gdy ostatnia aktywność była przed wczoraj', () => {
    expect(effectiveStreak(5, TODAY, TODAY, YESTERDAY)).toBe(5);
    expect(effectiveStreak(5, YESTERDAY, TODAY, YESTERDAY)).toBe(5);
    expect(effectiveStreak(5, '2026-01-01', TODAY, YESTERDAY)).toBe(0);
    expect(effectiveStreak(5, null, TODAY, YESTERDAY)).toBe(0);
  });

  it('pierwsze powiązanie: świeży gracz z serwera zamiast demo; avatar, bio i gmina domowa (gdy serwer nie ma) zostają', () => {
    const withAvatar = { ...local, user: { ...local.user, avatar: { kind: 'preset' as const, id: 'leaf' }, bio: 'Hej' } };
    const finds = [mapFind(sFind({ id: 'find-a', xxl: true }))];
    const trips = [mapTrip(sTrip({ id: 'trip-a', startedAt: iso(60) }), ['find-a'], undefined, NOW)];
    const out = buildUserState(state(), withAvatar, 'replace', ctx(finds, trips));
    expect(out.user).toMatchObject({
      id: 'user-1',
      name: 'Grzybiarz',
      firstName: 'Grzybiarz',
      handle: '@grzybiarz_1a2b',
      level: 1,
      xp: 170,
      streakDays: 1,
      tripsCount: 1,
      mushroomsCount: 1,
      homeGminaId: 'suprasl',
      avatar: { kind: 'preset', id: 'leaf' },
      bio: 'Hej',
    });
    expect(Object.keys(out.atlas ?? {})).toEqual(['borowik-szlachetny']);
    expect(out.badges).toEqual(['ranny-ptaszek']);
    expect(out.achievements).toEqual({ kolekcjoner: 1 });
    expect(out.pendingAchievements).toEqual([]);
    expect(out.quests).toMatchObject({ date: TODAY, pendingRewards: [] });
    expect(out.quests?.progress['q-rare-1']).toEqual({ questId: 'q-rare-1', progress: 1, completed: true });
    // Serwer sprzed progresji: część liczników ze znalezisk i profilu, reszta od zera (nowe konto, nie gracz demo).
    expect(out.counters).toMatchObject({ borowikiKnyszynska: 1, totalKm: 2.5, streakDays: 1, legendaryFinds: 0, xxlFinds: 1, trips: 1 });
    expect(out.counters).toMatchObject({ reactionsReceived: 0, gminy: [], maxStreak: 0 });
    // Zadania dnia: stała lista starszego serwera.
    expect(out.quests?.ids).toEqual(['q-scan-5', 'q-rare-1', 'q-km-5']);
    expect(out.today).toEqual({ date: TODAY, keys: ['suprasl:borowik-szlachetny'], km: 2.5 });
    expect(out.lastActiveDate).toBe(TODAY);
    expect(out.weeklyContribution).toBe(170);
  });

  it('kolejne: liczniki nie maleją (okno serwera), dzisiejsze klucze się łączą, postęp wyzwań gminy zostaje', () => {
    const l = {
      ...local,
      quests: { date: TODAY, progress: { 'ch:1': { questId: 'ch:1', progress: 1, completed: true } }, pendingRewards: [] },
      today: { date: TODAY, keys: ['hajnowka:czubajka-kania'], km: 3.1 },
    };
    const out = buildUserState(state({ profile: { ...state().profile, homeGminaId: 'hajnowka', firstName: 'Ola' } }), l, 'merge', ctx());
    expect(out.user).toMatchObject({ homeGminaId: 'hajnowka', firstName: 'Ola' });
    expect(out.counters?.xxlFinds).toBe(local.counters.xxlFinds);
    expect(out.counters?.borowikiKnyszynska).toBe(local.counters.borowikiKnyszynska);
    expect(out.quests?.progress['ch:1']?.completed).toBe(true);
    expect(out.today).toEqual({ date: TODAY, keys: ['hajnowka:czubajka-kania'], km: 3.1 });
    expect(out.weeklyContribution).toBeUndefined();
  });

  it('etap 4: wyzwania i obserwowane gminy z serwera wygrywają; ukończone dziś – zrobione w zadaniach, starsze znikają', () => {
    const challenge = (id: string, completedAt: string | null): ServerChallenge => ({
      id,
      gminaId: 'suprasl',
      title: `Wyzwanie ${id}`,
      speciesId: 'szmaciak-galezisty',
      description: 'Opis',
      xp: 500,
      badgeId: id === 'open' ? 'lowca-legend' : null,
      badgeName: id === 'open' ? 'Łowca Legend' : null,
      acceptedAt: iso(3 * 24 * 60),
      completedAt,
      endsAt: null,
    });
    const l = {
      ...local,
      followedGminy: ['narewka'],
      challenges: [{ id: 'mock-only', gminaId: 'grodek', title: 'Lokalne', speciesId: 'x', description: '', xp: 100, acceptedAt: iso(10) }],
      quests: {
        date: TODAY,
        progress: {
          'ch:mock-only': { questId: 'ch:mock-only', progress: 1, completed: true },
          'q-scan-5': { questId: 'q-scan-5', progress: 4, completed: false },
        },
        pendingRewards: [],
      },
    };
    const st = state({
      challenges: [challenge('open', null), challenge('today', iso(30)), challenge('old', iso(2 * 24 * 60))],
      followedGminy: ['suprasl', 'hajnowka'],
    });
    const out = buildUserState(st, l, 'merge', ctx());
    expect(out.followedGminy).toEqual(['suprasl', 'hajnowka']);
    expect(out.challenges?.map((c) => c.id)).toEqual(['open', 'today']);
    expect(out.challenges?.[0]).toEqual({
      id: 'open',
      gminaId: 'suprasl',
      title: 'Wyzwanie open',
      speciesId: 'szmaciak-galezisty',
      description: 'Opis',
      xp: 500,
      badgeId: 'lowca-legend',
      badgeName: 'Łowca Legend',
      acceptedAt: iso(3 * 24 * 60),
    });
    expect(out.challenges?.[1]).toMatchObject({ completedAt: iso(30) });
    expect(out.challenges?.[1]).not.toHaveProperty('badgeId');
    // Postęp wyzwań z serwera (lokalne `ch:` znikają), zadania dnia z serwera bez zmian.
    expect(Object.keys(out.quests?.progress ?? {}).filter((k) => k.startsWith('ch:'))).toEqual(['ch:today']);
    expect(out.quests?.progress['ch:today']).toEqual({ questId: 'ch:today', progress: 1, completed: true });
    expect(out.quests?.progress['q-rare-1']?.completed).toBe(true);
    expect(mapAcceptedChallenges(st.challenges ?? [], { today: YESTERDAY, now: NOW }).map((c) => c.id)).toEqual(['open']);
  });

  it('etap 4: nieukończone wyzwanie po terminie (tygodniowe) znika – termin z serwera albo z telefonu', () => {
    const base: ServerChallenge = {
      id: 'week', gminaId: 'lubien', title: 'Znajdź kurkę w tym tygodniu', speciesId: 'pieprznik-jadalny', description: '', xp: 150,
      badgeId: null, badgeName: null, acceptedAt: iso(8 * 24 * 60), completedAt: null, endsAt: null,
    };
    const ctx2 = { today: TODAY, now: NOW };
    // Serwer etapu 4 nie zwraca terminu – telefon zna go z ekranu gminy (przyjęcie wyzwania).
    const local = [{ id: 'week', gminaId: 'lubien', title: base.title, speciesId: base.speciesId, description: '', xp: 150, acceptedAt: base.acceptedAt, endsAt: iso(60) }];
    expect(mapAcceptedChallenges([base], { ...ctx2, local })).toEqual([]);
    expect(mapAcceptedChallenges([base], ctx2).map((c) => c.id)).toEqual(['week']);
    expect(mapAcceptedChallenges([{ ...base, endsAt: iso(-60) }], ctx2)[0]).toMatchObject({ id: 'week', endsAt: iso(-60) });
    expect(mapAcceptedChallenges([{ ...base, endsAt: iso(60) }], ctx2)).toEqual([]);
    // Ukończone dziś zostaje mimo terminu.
    expect(mapAcceptedChallenges([{ ...base, endsAt: iso(60), completedAt: iso(120) }], ctx2)).toHaveLength(1);
  });

  it('progresja: liczniki z serwera (player_metrics, snake_case), wylosowane zadania dnia i tygodnia', () => {
    const week = '2026-10-05'; // poniedziałek tygodnia NOW (wtorek 6.10)
    const st = state({
      quests: {
        day: TODAY,
        progress: [
          { questId: 'd-scan-3', progress: 2, completed: false },
          { questId: 'q-km-5', progress: 1.5, completed: false },
          { questId: 'd-epic-1', progress: 1, completed: true },
        ],
        daily: ['d-scan-3', 'q-km-5', 'd-epic-1'],
        week,
        weekly: [
          { questId: 'w-km-25', progress: 7.5, completed: false },
          { questId: 'w-trips-3', progress: 1, completed: false },
          { questId: 'w-react-15', progress: 0, completed: false },
        ],
      },
      counters: { trips: 12, total_km: 61.25, gminy: ['suprasl', 'hajnowka'], months: [9, 10], finds_at_1111: 1, seasons: 1, streak_days: 4 },
    });
    const local = { ...initialUserState(), counters: { ...initialUserState().counters, runSpeciesId: 'maslak-zwyczajny', runLength: 2 } };
    const out = buildUserState(st, local, 'merge', { now: NOW, gminaById, finds: [], trips: [] });
    expect(out.quests).toMatchObject({ date: TODAY, ids: ['d-scan-3', 'q-km-5', 'd-epic-1'] });
    expect(out.quests?.progress['d-epic-1']?.completed).toBe(true);
    expect(out.weeklyQuests).toEqual({
      week,
      ids: ['w-km-25', 'w-trips-3', 'w-react-15'],
      progress: {
        'w-km-25': { questId: 'w-km-25', progress: 7.5, completed: false },
        'w-trips-3': { questId: 'w-trips-3', progress: 1, completed: false },
        'w-react-15': { questId: 'w-react-15', progress: 0, completed: false },
      },
      km: 7.5,
    });
    // Dystans dnia z zadania dystansu wylosowanego na dziś (q-km-5).
    expect(out.today?.km).toBe(1.5);
    expect(out.counters).toMatchObject({ trips: 12, totalKm: 61.25, gminy: ['suprasl', 'hajnowka'], months: [9, 10], findsAt1111: 1 });
    // Seria z profilu (przerwana / bieżąca), bieżąca seria gatunku zostaje z telefonu.
    expect(out.counters).toMatchObject({ streakDays: 1, runSpeciesId: 'maslak-zwyczajny', runLength: 2 });

    // Przypięte zadania z makiety (scenariusz dev) zostają lokalne.
    const pinned = { ...local, quests: { date: TODAY, progress: {}, pendingRewards: [], ids: ['q-scan-5', 'q-rare-1', 'q-km-5'], pinned: true } };
    expect(buildUserState(st, pinned, 'merge', { now: NOW, gminaById, finds: [], trips: [] }).quests).toMatchObject({
      ids: ['q-scan-5', 'q-rare-1', 'q-km-5'],
      pinned: true,
    });
    // Nowe konto (replace): bez lokalnych liczników gracza demo.
    expect(buildUserState(st, local, 'replace', { now: NOW, gminaById, finds: [], trips: [] }).counters).toMatchObject({
      trips: 12,
      reactionsReceived: 0,
      runLength: 0,
    });
  });

  it('progresja: parseGameState czyta counters i zadania tygodnia; starszy serwer – null', () => {
    const raw = {
      ...state(),
      quests: { day: TODAY, progress: [], daily: ['d-scan-3'], week: '2026-10-05', weekly: [{ questId: 'w-km-25', progress: '2.5', completed: false }] },
      counters: { trips: 3 },
    };
    const p = parseGameState(JSON.parse(JSON.stringify(raw)));
    expect(p.quests).toMatchObject({ daily: ['d-scan-3'], week: '2026-10-05', weekly: [{ questId: 'w-km-25', progress: 2.5, completed: false }] });
    expect(p.counters).toEqual({ trips: 3 });
    const old = parseGameState(JSON.parse(JSON.stringify({ ...state(), quests: { day: TODAY, progress: [] }, counters: undefined })));
    expect(old.quests).toMatchObject({ daily: null, week: null, weekly: null });
    expect(old.counters).toBeNull();
  });

  it('serwer sprzed etapu 4: obserwowane gminy i przyjęte wyzwania zostają lokalne', () => {
    const l = { ...local, followedGminy: ['narewka'], challenges: [] };
    const out = buildUserState(state(), l, 'replace', ctx());
    expect(out).not.toHaveProperty('followedGminy');
    expect(out).not.toHaveProperty('challenges');
  });

  it('liczniki ze znalezisk: tylko odebrane; borowiki z Puszczy Knyszyńskiej, legendarne, XXL zebrane', () => {
    const finds = [
      localFind({ id: '1' }),
      localFind({ id: '2', gminaId: 'hajnowka' }),
      localFind({ id: '3', rarity: 'legendarny', xxl: true, collected: false }),
      localFind({ id: '4', status: 'pending', xxl: true }),
    ];
    expect(deriveCounters(finds, gminaById)).toEqual({ borowikiKnyszynska: 1, legendaryFinds: 1, xxlFinds: 0 });
  });
});

describe('dane do serwera', () => {
  it('gracz demo do dev_import_state: profil bez „@”, atlas, odznaki', () => {
    const p = buildImportState(initialUserState());
    expect(p.profile).toEqual({
      displayName: 'Kuba Nowak',
      firstName: 'Kuba',
      handle: 'kuba.grzyb',
      homeGminaId: 'suprasl',
      level: 14,
      xpInLevel: 2340,
      streakDays: 3,
      tripsCount: 42,
      mushroomsCount: 318,
    });
    expect(p.atlas).toHaveLength(23);
    expect(p.atlas.find((a) => a.speciesId === 'borowik-szlachetny')).toMatchObject({ count: 14, bestCapCm: 16, bestWeightG: 520 });
    expect(p.badges).toEqual(['ranny-ptaszek', 'km-100', 'seria-7']);
    expect(profilePayload(initialUserState().user).handle).toBe('kuba.grzyb');
  });

  it('zdarzenia → RPC zgodnie z kontraktem (wymiary snake_case, bez śladu GPS)', () => {
    const submit = rpcFor(
      makeItem({
        type: 'find.submit',
        payload: {
          findId: 'f',
          tripId: null,
          gminaId: 'suprasl',
          speciesId: 'pieprznik-jadalny',
          rarity: 'pospolity',
          confidence: 0.91,
          xxl: false,
          dimensions: { capCm: 5, heightCm: 6, weightG: 160, ageDays: 3, pieces: 12 },
          candidates: [{ speciesId: 'pieprznik-jadalny', confidence: 0.91 }],
          parts: ['cap', 'stem'],
          foundAt: iso(0),
        },
      }),
    );
    expect(submit).toEqual({
      fn: 'submit_find',
      params: {
        p_find_id: 'f',
        p_trip_id: null,
        p_gmina_id: 'suprasl',
        p_species_id: 'pieprznik-jadalny',
        p_rarity: 'pospolity',
        p_confidence: 0.91,
        p_xxl: false,
        p_dimensions: { cap_cm: 5, height_cm: 6, weight_g: 160, age_days: 3, pieces: 12 },
        p_candidates: [{ species_id: 'pieprznik-jadalny', confidence: 0.91 }],
        p_parts: ['cap', 'stem'],
        p_found_at: iso(0),
      },
    });
    const fin = rpcFor(makeItem({ type: 'trip.finish', payload: { tripId: 't', distanceM: 7400, durationS: 11520, endedAt: iso(0) } }));
    expect(fin).toEqual({
      fn: 'finish_trip',
      params: { p_trip_id: 't', p_distance_m: 7400, p_duration_s: 11520, p_track_geojson: null, p_ended_at: iso(0) },
    });
    expect(rpcFor(makeItem({ type: 'trip.start', payload: { tripId: 't', gminaId: 'g', startedAt: iso(5) } }))).toEqual({
      fn: 'start_trip',
      params: { p_gmina_id: 'g', p_trip_id: 't', p_started_at: iso(5) },
    });
    // Etap 4: wyzwania i obserwowane gminy.
    expect(rpcFor(makeItem({ type: 'challenge.accept', payload: { challengeId: 'ch-uuid', gminaId: 'suprasl' } }))).toEqual({
      fn: 'accept_challenge',
      params: { p_challenge_id: 'ch-uuid' },
    });
    expect(rpcFor(makeItem({ type: 'gmina.follow', payload: { gminaId: 'suprasl', follow: false } }))).toEqual({
      fn: 'follow_gmina',
      params: { p_gmina_id: 'suprasl', p_follow: false },
    });
  });

  it('klasyfikacja błędów: sieć / sesja / chwilowe / trwałe', () => {
    expect(classifyError({ message: 'TypeError: Network request failed', code: '', status: 0 })).toBe('network');
    expect(classifyError({ message: 'Bad gateway', code: '', status: 502 })).toBe('network');
    expect(classifyError({ message: 'not_authenticated', code: '28000', status: 401 })).toBe('auth');
    expect(classifyError({ message: 'JWT expired', code: 'PGRST303', status: 401 })).toBe('auth');
    expect(classifyError({ message: 'deadlock detected', code: '40P01', status: 500 })).toBe('server');
    expect(classifyError({ message: 'Could not find the function', code: 'PGRST202', status: 404 })).toBe('server');
    expect(classifyError({ message: 'unknown_gmina', code: 'P0001', status: 400 })).toBe('permanent');
    expect(classifyError({ message: 'trip_not_found', code: 'P0002', status: 400 })).toBe('permanent');
    expect(classifyError({ message: 'duplicate key', code: '23505', status: 409 })).toBe('permanent');
  });

  it('limit serwera (rate_limited) odkłada zdarzenie do terminu z podpowiedzi, z granicami 30 s – 24 h', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const err = (hint?: string) => ({ message: 'rate_limited', code: 'P0001', status: 400, details: 'Za dużo znalezisk', hint });
    expect(classifyError(err())).toBe('rate_limited');
    expect(retryAfterMs(err('retry_after=2026-10-07T12:05:00Z'), now)).toBe(5 * 60_000);
    expect(retryAfterMs(err(), now)).toBe(RATE_LIMIT_DEFER_MS);
    expect(retryAfterMs(err('retry_after=2026-10-07T12:00:01Z'), now)).toBe(30_000);
    expect(retryAfterMs(err('retry_after=2026-10-20T12:00:00Z'), now)).toBe(24 * 3_600_000);
    const a = makeItem({ type: 'find.claim', payload: { findId: 'f1' } });
    const b = makeItem({ type: 'find.claim', payload: { findId: 'f2' } });
    const out = deferUntil([a, b], a.id, 'rate_limited', now + 1000);
    expect(out[0]).toMatchObject({ id: a.id, attempts: 0, nextAttemptAt: now + 1000, lastError: 'rate_limited' });
    expect(out[1]).toBe(b);
  });
});
