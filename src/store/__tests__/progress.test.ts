/**
 * Progresja w telefonie (tryb mock): liczniki z akcji gry, zadania rotacyjne dzienne i tygodniowe, odznaki z liczników,
 * osiągnięcia z XP i przypięte zadania z makiety w scenariuszach dev-linków.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { Identification, Quest } from '@/types';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]) }));
jest.mock('@/services/live/findPhotos', () => ({ clearFindPhotos: () => {}, deleteFindPhoto: () => {} }));
jest.mock('@/services/live/avatarPhoto', () => ({ pruneAvatarFiles: () => {}, resolveAvatarUri: (uri: string) => uri }));
jest.mock('@/services/live/weather', () => ({ clearWeatherCache: () => {} }));

const game = require('../game') as typeof import('../game');
const progress = require('../progress') as typeof import('../progress');
const { useCatalogStore } = require('../useCatalogStore') as typeof import('../useCatalogStore');
const { useTripStore } = require('../useTripStore') as typeof import('../useTripStore');
const { questsFor, todayKey, useUserStore } = require('../useUserStore') as typeof import('../useUserStore');
const { ui } = require('../useUiStore') as typeof import('../useUiStore');
const { SPECIES } = require('../../data/mock/species') as typeof import('../../data/mock/species');
const { GMINY } = require('../../data/mock/gminy') as typeof import('../../data/mock/gminy');
const { BADGES, QUEST_POOL } = require('../../data/mock/game') as typeof import('../../data/mock/game');
const { EMPTY_COUNTERS } = require('../../utils/counters') as typeof import('../../utils/counters');
const { selectQuests, weekStartKey } = require('../../utils/quests') as typeof import('../../utils/quests');
/* eslint-enable @typescript-eslint/no-require-imports */

const ident = (speciesId: string, rarity: Identification['rarity'] = 'pospolity'): Identification => ({
  speciesId,
  confidence: 0.94,
  rarity,
  xxl: false,
  dimensions: { capCm: 8, heightCm: 9, weightG: 100, ageDays: 3 },
  lookalikes: [],
  candidates: [{ speciesId, confidence: 0.94 }],
});

/** Pula zawężona do wybranych szablonów – losowanie zwraca dokładnie je (po jednym rodzaju). */
const usePool = (ids: string[]) => {
  const pool: Quest[] = QUEST_POOL.filter((q) => ids.includes(q.id));
  useCatalogStore.setState({ dailyQuests: pool });
  const u = useUserStore.getState();
  u.patch(questsFor(u.user.id, todayKey()));
  const sel = selectQuests(pool, u.user.id, todayKey());
  u.patch({ quests: { ...u.quests, ids: sel.daily.map((q) => q.id) }, weeklyQuests: { ...u.weeklyQuests, ids: sel.weekly.map((q) => q.id) } });
};

const claim = (speciesId: string, rarity: Identification['rarity'] = 'pospolity', gminaId = 'suprasl') => {
  const f = game.createPendingFind(ident(speciesId, rarity), gminaId);
  return game.claimFind(f.id)!;
};

let toast: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  toast = jest.spyOn(ui, 'toast').mockImplementation(() => {});
  useCatalogStore.setState({
    ready: true,
    species: SPECIES,
    speciesById: Object.fromEntries(SPECIES.map((s) => [s.id, s])),
    gminy: GMINY,
    gminaById: Object.fromEntries(GMINY.map((g) => [g.id, g])),
    badges: BADGES,
    badgeById: Object.fromEntries(BADGES.map((b) => [b.id, b])),
    dailyQuests: QUEST_POOL,
  });
  useTripStore.getState().reset();
  useUserStore.getState().reset({ ...game.freshPlayerState({ id: 'u-test', homeGminaId: 'suprasl' }) });
});

afterEach(() => toast.mockRestore());

describe('zadania rotacyjne', () => {
  it('gracz dostaje 3 dzienne i 3 tygodniowe z losowania; scenariusz makiety przypina zadania z makiety', () => {
    const { daily, weekly } = progress.currentQuests();
    const sel = selectQuests(QUEST_POOL, 'u-test', todayKey());
    expect(daily.map((q) => q.id)).toEqual(sel.daily.map((q) => q.id));
    expect(weekly.map((q) => q.id)).toEqual(sel.weekly.map((q) => q.id));
    expect(game.allQuests()).toHaveLength(3);
    progress.pinDesignQuests();
    expect(game.allQuests().map((q) => q.id)).toEqual(['q-scan-5', 'q-rare-1', 'q-km-5']);
    expect(game.weeklyQuestList()).toEqual([]);
  });

  it('znaleziska posuwają dzienne i tygodniowe; ukończone → XP i licznik wykonanych zadań', () => {
    usePool(['d-scan-3', 'd-epic-1', 'd-variety-3', 'w-scan-40', 'w-variety-10', 'w-trips-3']);
    claim('podgrzybek-brunatny');
    claim('podgrzybek-brunatny');
    const r = claim('borowik-szlachetny', 'epicki');
    expect(r.reward?.completedQuestIds).toEqual(expect.arrayContaining(['d-scan-3', 'd-epic-1']));
    const u = useUserStore.getState();
    expect(u.quests.progress['d-variety-3']).toMatchObject({ progress: 2, completed: false });
    expect(u.weeklyQuests.progress['w-scan-40']).toMatchObject({ progress: 3, completed: false });
    expect(u.weeklyQuests.progress['w-variety-10']).toMatchObject({ progress: 2 });
    expect(u.counters.dailyQuestsDone).toBe(2);
    const before = useUserStore.getState().weeklyContribution;
    game.grantPendingRewards();
    // Zeskanuj 3 (+60) i Epicki okaz (+300) – plus osiągnięcia zdobyte tymi znaleziskami.
    expect(useUserStore.getState().weeklyContribution - before).toBeGreaterThanOrEqual(360);
    expect(useUserStore.getState().quests.pendingRewards).toEqual([]);
    // Koniec wyprawy: „Zakończ 3 wyprawy” 1/3 (tygodniowe).
    game.finishTrip();
    expect(useUserStore.getState().weeklyQuests.progress['w-trips-3']).toMatchObject({ progress: 1, completed: false });
  });

  it('dystans: dzienne liczy kilometry dnia, tygodniowe – tygodnia; reset tygodnia w poniedziałek', () => {
    usePool(['d-km-2', 'd-scan-3', 'd-epic-1', 'w-km-25', 'w-scan-40', 'w-trips-3']);
    game.startTrip('suprasl');
    game.addDistance(1.5);
    game.addDistance(0.6);
    const u = useUserStore.getState();
    expect(u.quests.progress['d-km-2']).toMatchObject({ progress: 2, completed: true });
    expect(u.weeklyQuests).toMatchObject({ km: 2.1, week: weekStartKey(todayKey()) });
    expect(u.weeklyQuests.progress['w-km-25'].progress).toBe(2.1);
    // Tydzień temu: nowe losowanie i postęp od zera.
    u.patch({ weeklyQuests: { ...u.weeklyQuests, week: '2000-01-03' } });
    game.ensureDailyReset();
    expect(useUserStore.getState().weeklyQuests).toMatchObject({ week: weekStartKey(todayKey()), progress: {}, km: 0 });
  });

  it('publikacja i reakcje (społeczność) – zadania i liczniki', () => {
    usePool(['d-publish', 'd-react-3', 'd-scan-3', 'w-publish-2', 'w-react-15', 'w-scan-40']);
    const trip = game.startTrip('suprasl');
    game.finishTrip();
    game.markPublished(trip.id, 'post-1');
    game.markPublished(trip.id, 'post-1'); // ponownie – bez podwójnego liczenia
    game.noteSocial('reactionGiven');
    game.noteSocial('reactionGiven');
    game.noteSocial('reactionRemoved');
    game.noteSocial('comment');
    const u = useUserStore.getState();
    expect(u.counters).toMatchObject({ published: 1, reactionsGiven: 1, comments: 1 });
    expect(u.quests.progress['d-publish']?.completed).toBe(true);
    expect(u.weeklyQuests.progress['w-publish-2']).toMatchObject({ progress: 1 });
    expect(u.quests.progress['d-react-3']).toMatchObject({ progress: 2 });
  });
});

describe('liczniki, odznaki i osiągnięcia z akcji gry', () => {
  it('wyprawa i znaleziska: liczniki odkrywcy, okazów, wypraw; osiągnięcia z XP po zakończeniu', () => {
    game.startTrip('suprasl');
    claim('borowik-szlachetny', 'rzadki');
    claim('muchomor-czerwony', 'pospolity', 'hajnowka');
    game.addDistance(5.3);
    game.finishTrip();
    const c = useUserStore.getState().counters;
    expect(c).toMatchObject({ trips: 1, maxTripKm: 5.3, rareFinds: 1, poisonPhotos: 1, awayFinds: 1, maxTripFinds: 2, activeDays: 1, maxStreak: 1 });
    expect(c.gminy).toEqual(['suprasl', 'hajnowka']);
    expect(c.forests).toEqual(expect.arrayContaining(['Puszcza Knyszyńska']));
    const a = useUserStore.getState().achievements;
    expect(a['dlugi-marsz']).toBe(1); // 5 km na jednej wyprawie – od razu po zakończeniu
    expect(a['puszcze-i-bory']).toBeGreaterThanOrEqual(1);
  });

  it('odznaki z liczników poza znaleziskiem: 100 km (dystans), seria 7 dni (start wyprawy)', () => {
    const u = useUserStore.getState();
    u.patch({ counters: { ...EMPTY_COUNTERS, totalKm: 99.5 }, lastActiveDate: todayKey(new Date(Date.now() - 86400000)), user: { ...u.user, streakDays: 6 } });
    game.startTrip('suprasl');
    expect(useUserStore.getState().badges).toContain('seria-7');
    game.addDistance(0.6);
    expect(useUserStore.getState().badges).toContain('km-100');
    expect(useUserStore.getState().counters.maxStreak).toBe(7);
  });
});
