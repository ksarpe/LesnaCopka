/**
 * Walki o okaz w mockach: boty deterministyczne, okaz gracza z telefonu (sizeVerified), zgłoszenie / zastąpienie /
 * wycofanie, opóźnienie prywatności własnego okazu, trofea gracza demo, tryb offline i reset.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { Find } from '@/types';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/geo', () => ({
  missingGminy: () => Promise.resolve([]),
  gminaIndex: () => Promise.reject(new Error('brak indeksu')),
}));

const { mockContests: contests } = require('../contests') as typeof import('../contests');
const { useContestsDb } = require('../contestsDb') as typeof import('../contestsDb');
const { useMockDb } = require('../db') as typeof import('../db');
const { useSimStore } = require('../../../store/useSimStore') as typeof import('../../../store/useSimStore');
const { useTripStore } = require('../../../store/useTripStore') as typeof import('../../../store/useTripStore');
const { useMockDuelsDb } = require('../duelsDb') as typeof import('../duelsDb');
/* eslint-enable @typescript-eslint/no-require-imports */

/** Mocki czekają 250–900 ms („sieć”) – przewijamy zegar. */
async function call<T>(p: Promise<T>): Promise<T> {
  const settled = p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  await jest.advanceTimersByTimeAsync(3000);
  const r = await settled;
  if (!r.ok) throw r.e;
  return r.v;
}

// Piątek 9 października 2026, 12:00 czasu polskiego – tydzień walk od 5 października.
const NOW = new Date('2026-10-09T10:00:00Z');

function addFind(o: Partial<Find> = {}): Find {
  const f: Find = {
    id: `f-${Math.random().toString(36).slice(2)}`,
    tripId: null,
    speciesId: 'borowik-szlachetny',
    gminaId: 'suprasl',
    rarity: 'rzadki',
    confidence: 0.95,
    xxl: false,
    dimensions: { capCm: 21, heightCm: 17, weightG: 520, ageDays: 4 },
    collected: true,
    status: 'claimed',
    foundAt: '2026-10-09T08:00:00Z',
    verified: true,
    sizeVerified: true,
    ...o,
  };
  useTripStore.getState().upsertFind(f);
  return f;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  useMockDb.getState().reset();
  useContestsDb.getState().reset();
  useTripStore.getState().reset();
  useMockDuelsDb.getState().set({ showInRankings: true });
  useSimStore.getState().set({ networkEnabled: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('walki o okaz (mock)', () => {
  it('tydzień: trzy walki, liderzy w województwie, rozstrzygnięty poprzedni tydzień', async () => {
    const week = await call(contests.getContestWeek());
    expect(week.weekStart).toBe('2026-10-05');
    expect(week.contests.map((c) => c.id)).toEqual([
      '2026-10-05:okaz',
      '2026-10-05:maslak-zwyczajny',
      '2026-10-05:czubajka-kania',
    ]);
    expect(week.contests.every((c) => c.status === 'open' && c.entrants > 0)).toBe(true);
    expect(week.leaders['2026-10-05:okaz']).toMatchObject({ rank: 1, isMine: false });
    expect(week.mine).toEqual({});
    expect(week.previousWeekStart).toBe('2026-09-28');
    // Deterministycznie – drugi odczyt daje to samo.
    expect(await call(contests.getContestWeek())).toEqual(week);
  });

  it('tablice: gmina ⊂ województwo ⊂ Polska, kolejność wyników, cudze okazy dopiero po 24 h', async () => {
    const id = '2026-10-05:okaz';
    const gmina = await call(contests.getContestBoard(id, 'gmina'));
    const woj = await call(contests.getContestBoard(id, 'wojewodztwo'));
    const pl = await call(contests.getContestBoard(id, 'polska'));
    expect(gmina).toMatchObject({ scopeId: 'suprasl', scopeName: 'Gmina Supraśl' });
    expect(woj).toMatchObject({ scopeId: 'podlaskie', scopeName: 'podlaskie' });
    expect(gmina.total).toBeLessThanOrEqual(woj.total);
    expect(woj.total).toBeLessThan(pl.total);
    expect(pl.entries.map((e) => e.rank)).toEqual(pl.entries.map((_, i) => i + 1));
    const scores = pl.entries.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    pl.entries.forEach((e) => expect(Date.parse(e.foundAt) + 24 * 3_600_000).toBeLessThanOrEqual(NOW.getTime()));
  });

  it('zgłoszenie okazu: miejsce przed zgłoszeniem, okaz na tablicy bez miejsca do upływu 24 h, potem z miejscem', async () => {
    const f = addFind();
    const before = await call(contests.getContestEligibility(f.id));
    expect(before).toMatchObject({ eligible: true, reason: null, prizeEligible: true });
    expect(before.contests.map((m) => m.contest.id)).toEqual(['2026-10-05:okaz']);
    expect(before.contests[0]).toMatchObject({ score: 175, entered: false, currentBest: null });

    const after = await call(contests.enterContest(f.id));
    expect(after.contests[0].entered).toBe(true);

    const board = await call(contests.getContestBoard('2026-10-05:okaz', 'gmina'));
    expect(board.mine).toMatchObject({ isMine: true, rank: null, findId: f.id, visibleFrom: '2026-10-10T08:00:00.000Z' });
    expect(board.entries.some((e) => e.isMine)).toBe(true);
    // Znajomi widzą od razu – tam ma miejsce.
    expect((await call(contests.getContestBoard('2026-10-05:okaz', 'znajomi'))).mine?.rank).toEqual(expect.any(Number));

    jest.setSystemTime(new Date('2026-10-10T09:00:00Z'));
    const later = await call(contests.getContestBoard('2026-10-05:okaz', 'gmina'));
    expect(later.mine).toMatchObject({ visibleFrom: null, rank: expect.any(Number) });
    const week = await call(contests.getContestWeek());
    expect(week.mine['2026-10-05:okaz']).toMatchObject({ findId: f.id, rank: expect.any(Number) });
  });

  it('nowy okaz zastępuje poprzedni (currentBest – wynik zgłoszonego), wycofanie usuwa okaz z walki', async () => {
    const big = addFind();
    await call(contests.enterContest(big.id));
    const small = addFind({ dimensions: { capCm: 13, heightCm: 14, weightG: 300, ageDays: 3 } });
    const elig = await call(contests.getContestEligibility(small.id));
    expect(elig.contests[0]).toMatchObject({ entered: false, currentBest: 175 });
    await call(contests.enterContest(small.id));
    expect(useContestsDb.getState().entries.map((e) => e.findId)).toEqual([small.id]);

    await call(contests.withdrawContestEntry('2026-10-05:okaz'));
    expect((await call(contests.getContestBoard('2026-10-05:okaz', 'gmina'))).mine).toBeNull();
  });

  it('okaz bez skali / kępka – odmowa z powodem, zgłoszenie rzuca SERVER', async () => {
    const noScale = addFind({ sizeVerified: false });
    const e = await call(contests.getContestEligibility(noScale.id));
    expect(e).toMatchObject({ eligible: false, contests: [] });
    expect(e.reason).toMatch(/odniesienia skali/);
    await expect(call(contests.enterContest(noScale.id))).rejects.toMatchObject({ code: 'SERVER' });
    await expect(call(contests.getContestEligibility('brak'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('gatunek tygodnia: okaz walczy w dwóch walkach naraz', async () => {
    const f = addFind({ speciesId: 'maslak-zwyczajny', dimensions: { capCm: 9, heightCm: 6, weightG: 60, ageDays: 2 } });
    const after = await call(contests.enterContest(f.id));
    expect(after.contests.map((m) => m.contest.id)).toEqual(['2026-10-05:okaz', '2026-10-05:maslak-zwyczajny']);
    expect(after.contests[1].score).toBe(9);
  });

  it('trofea gracza demo z poprzednich tygodni; nowy gracz – bez historii; poprzedni tydzień rozstrzygnięty', async () => {
    const demo = await call(contests.getTrophies());
    expect(demo.items.length).toBeGreaterThan(0);
    expect(demo.gold + demo.silver + demo.bronze).toBe(demo.items.length);
    expect(demo.items.filter((t) => t.contestId === '2026-09-28:okaz' && t.xp > 0).length).toBeLessThanOrEqual(1);
    const prev = await call(contests.getContestBoard('2026-09-28:okaz', 'gmina'));
    expect(prev.contest.status).toBe('final');
    expect(prev.mine).toMatchObject({ speciesId: 'borowik-szlachetny', rank: expect.any(Number) });

    useContestsDb.getState().reset({ emptyFeed: true });
    expect((await call(contests.getTrophies())).items).toEqual([]);
    // Trofea innego grzybiarza (mini profil).
    const other = await call(contests.getTrophies('u-jurek'));
    expect(other.items.every((t) => t.place >= 1 && t.place <= 3)).toBe(true);
  });

  it('nieznana / przyszła walka – NOT_FOUND; bez sieci – NETWORK; zgłoszenie cudzego okazu', async () => {
    await expect(call(contests.getContestBoard('2026-10-05:borowik-szlachetny', 'polska'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(call(contests.getContestBoard('2026-10-12:okaz', 'polska'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const pl = await call(contests.getContestBoard('2026-10-05:okaz', 'polska'));
    await call(contests.reportContestEntry(pl.entries[0].id, 'reproduction'));
    expect(useContestsDb.getState().reported).toEqual([pl.entries[0].id]);
    useSimStore.getState().set({ networkEnabled: false });
    await expect(call(contests.getContestWeek())).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('mój okaz zawsze w `mine` (jak serwer): poza zasięgiem i u ukrytego w rankingach – bez miejsca', async () => {
    const f = addFind({ foundAt: '2026-10-07T08:00:00Z' });
    await call(contests.enterContest(f.id));
    // Okaz z Supraśla na tablicy Hajnówki – bez miejsca i bez pozycji na liście.
    const other = await call(contests.getContestBoard('2026-10-05:okaz', 'gmina', 'hajnowka'));
    expect(other.mine).toMatchObject({ findId: f.id, rank: null, gminaId: 'suprasl' });
    expect(other.entries.some((e) => e.isMine)).toBe(false);
    expect((await call(contests.getContestBoard('2026-10-05:okaz', 'gmina'))).mine?.rank).toEqual(expect.any(Number));

    // Ukryty w rankingach: w zasięgach publicznych bez miejsca (i bez „po 24 h”), wśród znajomych – z miejscem.
    useMockDuelsDb.getState().set({ showInRankings: false });
    const hidden = await call(contests.getContestBoard('2026-10-05:okaz', 'wojewodztwo'));
    expect(hidden.mine).toMatchObject({ findId: f.id, rank: null, visibleFrom: null });
    expect(hidden.entries.some((e) => e.isMine)).toBe(false);
    expect((await call(contests.getContestBoard('2026-10-05:okaz', 'znajomi'))).mine?.rank).toEqual(expect.any(Number));
    expect((await call(contests.getContestWeek())).mine['2026-10-05:okaz']).toMatchObject({ rank: null });
  });

  it('zablokowany znika z tablic', async () => {
    const pl = await call(contests.getContestBoard('2026-10-05:okaz', 'polska'));
    const victim = pl.entries.find((e) => e.author.id.startsWith('u-') && !e.author.id.startsWith('u-bot'))!;
    useMockDb.getState().set({ blocked: [{ id: victim.author.id, at: NOW.toISOString() }] });
    const after = await call(contests.getContestBoard('2026-10-05:okaz', 'polska'));
    expect(after.entries.some((e) => e.author.id === victim.author.id)).toBe(false);
  });
});
