import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { Find } from '@/types';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const { mockDuels, botFinds } = require('../duels') as typeof import('../duels');
const { useMockDuelsDb } = require('../duelsDb') as typeof import('../duelsDb');
const { mockPlayerRanking, botRankXp } = require('../duelsRanking') as typeof import('../duelsRanking');
const { useMockDb } = require('../db') as typeof import('../db');
const { useSimStore } = require('../../../store/useSimStore') as typeof import('../../../store/useSimStore');
const { useTripStore } = require('../../../store/useTripStore') as typeof import('../../../store/useTripStore');
const { useUserStore } = require('../../../store/useUserStore') as typeof import('../../../store/useUserStore');
const { useNotificationStore } = require('../../../store/useNotificationStore') as typeof import('../../../store/useNotificationStore');
const { duelOutcome, DUEL_GRACE_MS } = require('../../../utils/duels') as typeof import('../../../utils/duels');
/* eslint-enable @typescript-eslint/no-require-imports */


const H = 3_600_000;
const DAY = 24 * H;
const T0 = new Date('2026-10-07T08:00:00Z').getTime();

/** Mocki czekają 200–1000 ms („sieć”) – przewijamy zegar. */
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

const at = (t: number) => jest.setSystemTime(t);
const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

beforeEach(() => {
  jest.useFakeTimers();
  at(T0);
  useMockDb.getState().reset();
  useMockDuelsDb.getState().reset();
  useTripStore.getState().reset();
  useUserStore.getState().reset();
  useNotificationStore.getState().reset();
  useSimStore.getState().set({ networkEnabled: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('pojedynki (mock)', () => {
  it('na start: wyzwanie bota do gracza, trwający pojedynek i historia z bilansem', async () => {
    const o = await call(mockDuels.getDuels());
    expect(o.incoming).toHaveLength(1);
    expect(o.incoming[0]).toMatchObject({ kind: 'biggest', days: 3, status: 'pending', iAmChallenger: false, opponent: { user: { id: 'u-ola' } } });
    expect(ms(o.incoming[0].expiresAt) - ms(o.incoming[0].createdAt)).toBe(48 * H);
    expect(o.active).toHaveLength(1);
    expect(o.active[0]).toMatchObject({ kind: 'count', status: 'active', opponent: { user: { id: 'u-marek' } } });
    // Bot już coś zebrał przez dobę pojedynku; gracz demo nie ma znalezisk w telefonie.
    expect(o.active[0].opponent.score).toBeGreaterThan(0);
    expect(o.active[0].me.score).toBe(0);
    expect(o.finished.map((d) => d.outcome)).toEqual(['won', 'lost', 'draw']);
    expect(o.record).toEqual({ won: 1, lost: 1, draw: 1 });
    // Drugi odczyt nie sieje od nowa.
    const again = await call(mockDuels.getDuels());
    expect(again.incoming[0].id).toBe(o.incoming[0].id);
    // Z narzędziami dev bot „wysyła” powiadomienie o wyzwaniu (kategoria „Rywalizacja”).
    const keys = useNotificationStore.getState().pending.map((p) => p.key);
    expect(keys).toContain(`activity.mock.${o.incoming[0].id}.duel_invite`);
    expect(useNotificationStore.getState().pending.find((p) => p.key.endsWith('duel_invite'))?.kind).toBe('rivalry');
  });

  it('przyjęcie wyzwania startuje pojedynek od teraz; drugi raz – odmowa', async () => {
    const { incoming } = await call(mockDuels.getDuels());
    const d = await call(mockDuels.respondDuel(incoming[0].id, true));
    expect(d.status).toBe('active');
    // Od chwili przyjęcia (zegar przesunął się o „sieć”).
    expect(ms(d.startsAt) - T0).toBeLessThan(5000);
    expect(ms(d.endsAt) - ms(d.startsAt)).toBe(3 * DAY);
    await expect(call(mockDuels.respondDuel(incoming[0].id, true))).rejects.toMatchObject({ code: 'SERVER' });
  });

  it('wyzwanie gracza: bot przyjmuje po kilku minutach, limity pary i 3 pojedynków w toku', async () => {
    await call(mockDuels.getDuels());
    const d = await call(mockDuels.createDuel('u-bartek', 'species', 1));
    expect(d).toMatchObject({ status: 'pending', iAmChallenger: true, kind: 'species', days: 1 });
    await expect(call(mockDuels.createDuel('u-bartek', 'count', 3))).rejects.toMatchObject({ code: 'SERVER', message: expect.stringContaining('w toku') });
    // Ola (oczekuje), Marek (trwa), Bartek (wysłane) = 3.
    await expect(call(mockDuels.createDuel('u-ewa', 'count', 3))).rejects.toMatchObject({ code: 'SERVER', message: expect.stringContaining('3 pojedynki') });
    await expect(call(mockDuels.createDuel('u-zosia', 'count', 3))).rejects.toMatchObject({ code: 'SERVER', message: 'Wyzwać możesz tylko znajomych' });

    at(T0 + 11 * 60_000);
    const after = await call(mockDuels.getDuel(d.id));
    expect(after.status).toBe('active');
    expect(after.startsAt).not.toBeNull();
  });

  it('przyjęcie przy komplecie 3 pojedynków w toku – odmowa jak na serwerze', async () => {
    const { incoming, active } = await call(mockDuels.getDuels());
    const extra = (id: string, botId: string) => ({ ...useMockDuelsDb.getState().duels.find((d) => d.id === active[0].id)!, id, botId });
    useMockDuelsDb.getState().set({ duels: [...useMockDuelsDb.getState().duels, extra('x1', 'u-bartek'), extra('x2', 'u-ewa')] });
    await expect(call(mockDuels.respondDuel(incoming[0].id, true))).rejects.toMatchObject({ code: 'SERVER', message: expect.stringContaining('to limit') });
    // Odrzucić można zawsze.
    expect((await call(mockDuels.respondDuel(incoming[0].id, false))).status).toBe('declined');
  });

  it('bot: jedno znalezisko = jeden grzyb (wynik „Najwięcej grzybów” = liczba znalezisk do chwili odczytu)', async () => {
    const { active } = await call(mockDuels.getDuels());
    const d = active[0];
    const r = { id: d.id, botId: d.opponent.user.id, startsAt: d.startsAt, days: d.days };
    expect(d.opponent.score).toBe(botFinds(r).filter((f) => f.at <= Date.now()).length);
  });

  it('ponowienie wyzwania z tym samym id (odpowiedź nie dotarła) – ten sam pojedynek, bez odmowy „masz już pojedynek”', async () => {
    await call(mockDuels.getDuels());
    const id = '22222222-2222-4222-8222-222222222222';
    const a = await call(mockDuels.createDuel('u-bartek', 'species', 1, id));
    const b = await call(mockDuels.createDuel('u-bartek', 'species', 1, id));
    expect(a.id).toBe(id);
    expect(b).toMatchObject({ id, status: 'pending' });
    expect((await call(mockDuels.getDuels())).outgoing).toHaveLength(1);
  });

  it('anulowanie własnego wyzwania; cudzego nie da się anulować', async () => {
    const { incoming } = await call(mockDuels.getDuels());
    const d = await call(mockDuels.createDuel('u-bartek', 'count', 3));
    await call(mockDuels.cancelDuel(d.id));
    const o = await call(mockDuels.getDuels());
    expect(o.outgoing).toHaveLength(0);
    expect(o.finished.find((x) => x.id === d.id)?.status).toBe('cancelled');
    await expect(call(mockDuels.cancelDuel(incoming[0].id))).rejects.toMatchObject({ code: 'SERVER' });
  });

  it('rozstrzygnięcie po końcu + 6 h: wynik gracza z jego znalezisk, wynik, XP i bilans', async () => {
    const { active } = await call(mockDuels.getDuels());
    const duel = active[0];
    const start = new Date(duel.startsAt!).getTime();
    const end = new Date(duel.endsAt!).getTime();
    const f = (id: string, dt: number, o: Partial<Find> = {}): Find => ({
      id,
      tripId: null,
      speciesId: 'borowik-szlachetny',
      gminaId: 'suprasl',
      rarity: 'rzadki',
      confidence: 0.9,
      xxl: false,
      dimensions: { capCm: 12, heightCm: 12, weightG: 300, ageDays: 2 },
      collected: true,
      status: 'claimed',
      foundAt: new Date(start + dt).toISOString(),
      ...o,
    });
    useTripStore.getState().patch({
      finds: Object.fromEntries(
        [f('a', H), f('b', 2 * H), f('c', 3 * H, { collected: false }), f('d', -H), f('e', 4 * H, { verified: false })].map((x) => [x.id, x]),
      ),
    });
    const live = await call(mockDuels.getDuel(duel.id));
    expect(live.me.score).toBe(2);

    const xpBefore = useUserStore.getState().weeklyContribution;
    at(end + DUEL_GRACE_MS - 60_000);
    expect((await call(mockDuels.getDuel(duel.id))).status).toBe('active');
    at(end + DUEL_GRACE_MS + 60_000);
    const done = await call(mockDuels.getDuel(duel.id));
    expect(done.status).toBe('finished');
    expect(done.me.score).toBe(2);
    expect(done.outcome).toBe(duelOutcome(done.me.score, done.opponent.score));
    expect(done.xp).toBe(done.outcome === 'won' ? 100 : done.outcome === 'draw' ? 30 : 0);
    expect(useUserStore.getState().weeklyContribution).toBe(xpBefore + (done.xp ?? 0));
    const o = await call(mockDuels.getDuels());
    expect(o.record[done.outcome!]).toBe(2);
    // Wynik zapisany – kolejny odczyt nie dolicza XP drugi raz.
    await call(mockDuels.getDuels());
    expect(useUserStore.getState().weeklyContribution).toBe(xpBefore + (done.xp ?? 0));
  });

  it('nieprzyjęte wyzwanie wygasa po 48 h; blokada przeciwnika anuluje pojedynek', async () => {
    const { incoming, active } = await call(mockDuels.getDuels());
    useMockDb.getState().set({ blocked: [{ id: active[0].opponent.user.id, at: new Date(T0).toISOString() }] });
    at(T0 + 46 * H);
    const o = await call(mockDuels.getDuels());
    expect(o.incoming).toHaveLength(0);
    expect(o.finished.find((d) => d.id === incoming[0].id)?.status).toBe('expired');
    expect(o.finished.find((d) => d.id === active[0].id)?.status).toBe('cancelled');
  });

  it('nowy gracz (reset z pustym feedem) – bez zestawu startowego; offline – NETWORK', async () => {
    useMockDb.getState().reset({ emptyFeed: true });
    useMockDuelsDb.getState().reset({ emptyFeed: true });
    const o = await call(mockDuels.getDuels());
    expect([...o.active, ...o.incoming, ...o.outgoing, ...o.finished]).toHaveLength(0);
    useSimStore.getState().set({ networkEnabled: false });
    await expect(call(mockDuels.getDuels())).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('znaleziska bota są deterministyczne i tylko w oknie pojedynku', () => {
    const r = { id: 'x', botId: 'u-ola', startsAt: new Date(T0).toISOString(), days: 3 as const };
    const a = botFinds(r);
    expect(a.length).toBeGreaterThan(2);
    expect(botFinds(r)).toEqual(a);
    expect(a.every((f) => f.at > T0 && f.at < T0 + 3 * DAY)).toBe(true);
  });
});

describe('ranking grzybiarzy (mock)', () => {
  const base = {
    period: 'week' as const,
    scopeId: null,
    now: T0,
    me: { id: 'u-kuba', name: 'Kuba', level: 14, ringRarity: 'primary' as const },
    myXp: 1280,
    pendingXp: 200,
    home: { gminaId: 'suprasl', voivodeship: 'podlaskie' },
    gminaName: (id: string) => `Gmina ${id}`,
    friendIds: ['u-ola', 'u-marek'],
    isBlocked: () => false,
    hidden: false,
  };

  it('znajomi na żywo (z punktami z ostatnich 24 h), publiczne – bez świeżych punktów', () => {
    const f = mockPlayerRanking({ ...base, scope: 'znajomi' });
    expect(f).toMatchObject({ scope: 'znajomi', scopeName: 'Znajomi', live: true, pendingXp: 0, total: 3 });
    expect(f.me).toMatchObject({ xp: 1280, isMe: true });
    const g = mockPlayerRanking({ ...base, scope: 'gmina' });
    expect(g).toMatchObject({ scopeId: 'suprasl', scopeName: 'Gmina suprasl', live: false, pendingXp: 200 });
    expect(g.me?.xp).toBe(1080);
    expect(g.rows.map((r) => r.rank)).toEqual(g.rows.map((_, i) => i + 1));
    expect(g.rows.every((r, i) => i === 0 || g.rows[i - 1].xp >= r.xp)).toBe(true);
  });

  it('zasięgi rosną: gmina ⊂ województwo ⊂ Polska; najwyżej 50 wierszy', () => {
    const g = mockPlayerRanking({ ...base, scope: 'gmina' });
    const w = mockPlayerRanking({ ...base, scope: 'wojewodztwo' });
    const p = mockPlayerRanking({ ...base, scope: 'polska' });
    expect(w.scopeName).toBe('podlaskie');
    expect(g.total).toBeLessThan(w.total);
    expect(w.total).toBeLessThan(p.total);
    expect(p.rows.length).toBeLessThanOrEqual(50);
    expect(p.me?.rank).toBeGreaterThan(0);
  });

  it('ukryty gracz: poza zasięgami publicznymi, ale widoczny wśród znajomych', () => {
    const g = mockPlayerRanking({ ...base, scope: 'gmina', hidden: true });
    expect(g).toMatchObject({ hidden: true, me: null, pendingXp: 0 });
    expect(g.rows.some((r) => r.isMe)).toBe(false);
    expect(mockPlayerRanking({ ...base, scope: 'znajomi', hidden: true }).me).not.toBeNull();
  });

  it('bez gminy domowej – pusta gmina „Twoja gmina”; zablokowani znikają', () => {
    expect(mockPlayerRanking({ ...base, scope: 'gmina', home: null })).toMatchObject({ scopeId: null, scopeName: 'Twoja gmina', rows: [], total: 0 });
    const w = mockPlayerRanking({ ...base, scope: 'wojewodztwo', isBlocked: (id) => id === 'u-ola' });
    expect(w.rows.some((r) => r.user.id === 'u-ola')).toBe(false);
  });

  it('punkty botów: stałe w tygodniu, sezon ≥ tydzień', () => {
    expect(botRankXp('u-ola', 'week', T0)).toBe(botRankXp('u-ola', 'week', T0 + 2 * H));
    expect(botRankXp('u-ola', 'season', T0)).toBeGreaterThanOrEqual(botRankXp('u-ola', 'week', T0));
  });

  it('serwis: widoczność z ustawienia, status rywalizacji', async () => {
    expect(await call(mockDuels.getRivalryStatus())).toEqual({ showInRankings: true, standing: 'ok', accountSecured: true });
    await call(mockDuels.setRankingVisibility(false));
    expect((await call(mockDuels.getRivalryStatus())).showInRankings).toBe(false);
    const r = await call(mockDuels.getPlayerRanking('polska', 'week'));
    expect(r).toMatchObject({ hidden: true, me: null });
  });
});
