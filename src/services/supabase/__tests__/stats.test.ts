/**
 * StatsService na Supabase z atrapą klienta: wywołania RPC (kontrakt z docs/backend.md), stan „Obserwuj” /
 * „Wyzwanie przyjęte” z serwera, błędy i brak sieci, narzędzia /dev. Mapowanie pól – statsMap.test.ts.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, unknown>;
type Res = { data?: unknown; error?: { message: string; code: string } };

const mockRpc = {
  online: true,
  calls: [] as { fn: string; params: Row }[],
  handlers: {} as Record<string, (p: Row) => Res>,
  reset() {
    this.online = true;
    this.calls = [];
    this.handlers = {};
  },
  respond(fn: string, params: Row) {
    if (!this.online) return { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 };
    this.calls.push({ fn, params });
    const r = this.handlers[fn]?.(params) ?? { error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
    return r.error ? { data: null, error: r.error, status: 400 } : { data: r.data ?? null, error: null, status: 200 };
  },
};

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]) }));
jest.mock('../client', () => ({
  BACKEND: 'supabase',
  SUPABASE_URL: 'http://test',
  supabaseEnabled: true,
  supabase: {
    rpc: (fn: string, params?: Row) => {
      const p = Promise.resolve().then(() => mockRpc.respond(fn, params ?? {}));
      return Object.assign(p, { abortSignal: () => p });
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'me' } } } }),
      signInAnonymously: async () => ({ data: { user: { id: 'me' } }, error: null }),
    },
  },
}));

const { createSupabaseStats, devRefreshRankings, devSeedActivity } = require('../stats') as typeof import('../stats');
const { backendStatus } = require('../status') as typeof import('../status');
const { setOutboxEnabled, useOutboxStore } = require('../../../store/useOutboxStore') as typeof import('../../../store/useOutboxStore');
const { isServerPatch, useUserStore } = require('../../../store/useUserStore') as typeof import('../../../store/useUserStore');
const { ServiceError } = require('../../types') as typeof import('../../types');
/* eslint-enable @typescript-eslint/no-require-imports */

const stats = createSupabaseStats();

const gminaStats = (o: Row = {}) => ({
  gminaId: 'suprasl',
  name: 'Supraśl',
  rank: 2,
  mushroomers: 41,
  mushrooms: 312,
  species: 12,
  records: [],
  distribution: [],
  challenge: { id: 'ch-1', title: 'Znajdź szmaciaka', speciesId: 'szmaciak-galezisty', description: 'Opis', xp: 500, badgeId: null, badgeName: null, endsAt: null },
  challengeAccepted: false,
  challengeCompleted: false,
  followed: false,
  ...o,
});

beforeEach(() => {
  mockRpc.reset();
  setOutboxEnabled(true);
  useOutboxStore.getState().reset();
  useUserStore.getState().reset();
  backendStatus().set({ state: 'online', userId: 'me', error: null });
});

describe('StatsService (Supabase)', () => {
  it('ranking: get_ranking z okresem i województwem (domyślnie podlaskie), wiersze w formacie aplikacji', async () => {
    mockRpc.handlers.get_ranking = (p) => ({
      data: {
        period: p.p_period,
        voivodeship: p.p_voivodeship,
        rows: [{ gminaId: 'suprasl', name: 'Supraśl', kind: 'miejsko-wiejska', powiat: 'białostocki', forest: 'Puszcza Knyszyńska', rank: 1, points: 18420, mushroomers: 12, trend: null }],
        heat: { suprasl: 4 },
        userContribution: 120,
        userGminaId: 'suprasl',
      },
    });
    expect(stats.live).toBe(true);
    const r = await stats.getRanking('week', { voivodeship: 'mazowieckie' });
    expect(mockRpc.calls[0]).toEqual({ fn: 'get_ranking', params: { p_period: 'week', p_voivodeship: 'mazowieckie' } });
    expect(r).toMatchObject({ voivodeship: 'mazowieckie', heat: { suprasl: 4 }, userContribution: 120, mushroomers: { suprasl: 12 } });
    expect(r.rows[0]).toMatchObject({ points: '18 420', sub: 'Puszcza Knyszyńska · 12 grzybiarzy' });
    await stats.getRanking('records');
    expect(mockRpc.calls[1].params).toEqual({ p_period: 'records', p_voivodeship: 'podlaskie' });
  });

  it('bez sieci – NETWORK (ekran pokazuje stan offline, bez mocków); nieznane województwo / gmina – NOT_FOUND', async () => {
    mockRpc.online = false;
    await expect(stats.getRanking('week')).rejects.toMatchObject({ code: 'NETWORK' });
    mockRpc.online = true;
    mockRpc.handlers.get_ranking = () => ({ error: { message: 'invalid_voivodeship', code: 'P0001' } });
    mockRpc.handlers.get_gmina_stats = () => ({ error: { message: 'gmina_not_found', code: 'P0002' } });
    const e = await stats.getRanking('week', { voivodeship: 'xyz' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServiceError);
    expect(e).toMatchObject({ code: 'NOT_FOUND', message: 'Nieznane województwo' });
    await expect(stats.getGminaStats('nie-ma')).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Nie znaleziono gminy' });
  });

  it('szczegóły gminy: „Obserwuj” i przyjęte wyzwanie z serwera trafiają do telefonu (bez zdarzeń w kolejce)', async () => {
    mockRpc.handlers.get_gmina_stats = (p) => ({ data: gminaStats({ gminaId: p.p_gmina_id, followed: true, challengeAccepted: true }) });
    let flagged = false;
    const unsub = useUserStore.subscribe(() => (flagged = flagged || isServerPatch()));
    const s = await stats.getGminaStats('suprasl');
    unsub();
    expect(mockRpc.calls[0]).toEqual({ fn: 'get_gmina_stats', params: { p_gmina_id: 'suprasl' } });
    expect(s).toMatchObject({ rank: 2, followed: true, challengeAccepted: true, challenge: { id: 'ch-1', xp: 500 } });
    expect(s.challenge).not.toHaveProperty('badgeName');
    const u = useUserStore.getState();
    expect(u.followedGminy).toEqual(['suprasl']);
    expect(u.challenges).toEqual([expect.objectContaining({ id: 'ch-1', gminaId: 'suprasl', title: 'Znajdź szmaciaka' })]);
    expect(useOutboxStore.getState().items).toEqual([]);
    // Zmiana z serwera – NotificationsHost nie wita „Obserwujesz gminę…”.
    expect(flagged).toBe(true);
  });

  it('czekające w kolejce „Obserwuj” / „Przyjmij wyzwanie” wygrywają z (jeszcze starym) stanem serwera', async () => {
    useUserStore.getState().patch({ followedGminy: ['suprasl'] });
    useOutboxStore.getState().enqueue({ type: 'gmina.follow', payload: { gminaId: 'suprasl', follow: true } }, { kick: false });
    useOutboxStore.getState().enqueue({ type: 'challenge.accept', payload: { challengeId: 'ch-1', gminaId: 'suprasl' } }, { kick: false });
    useUserStore.getState().patch({
      challenges: [{ id: 'ch-1', gminaId: 'suprasl', title: 'Znajdź szmaciaka', speciesId: 'szmaciak-galezisty', description: 'Opis', xp: 500, acceptedAt: '2026-10-07T10:00:00.000Z' }],
    });
    mockRpc.handlers.get_gmina_stats = () => ({ data: gminaStats() });
    await stats.getGminaStats('suprasl');
    expect(useUserStore.getState().followedGminy).toEqual(['suprasl']);
    expect(useUserStore.getState().challenges.map((c) => c.id)).toEqual(['ch-1']);
  });

  it('porównanie okazu: get_species_percentile z wagą w gramach; brak danych w gminie → collected 0', async () => {
    mockRpc.handlers.get_species_percentile = () => ({ data: { collected: 0, mushroomers: 0, sizeRank: 1, percentile: 100, biggerCount: 0 } });
    const p = await stats.getSpeciesPercentile('borowik-szlachetny', 'suprasl', { capCm: 14, heightCm: 17, weightG: 410.4, ageDays: 5 });
    expect(mockRpc.calls[0]).toEqual({
      fn: 'get_species_percentile',
      params: { p_species_id: 'borowik-szlachetny', p_gmina_id: 'suprasl', p_weight_g: 410 },
    });
    expect(p).toEqual({ speciesId: 'borowik-szlachetny', gminaId: 'suprasl', collected: 0, mushroomers: 0, sizeRank: 1, percentile: 100, biggerCount: 0 });
  });
});

describe('panel /dev – rankingi', () => {
  it('generator aktywności dla województwa (serwer sam przelicza rankingi); przeliczenie na żądanie', async () => {
    mockRpc.handlers.dev_seed_activity = (p) => ({
      data: { voivodeship: p.p_voivodeship, bots: 60, finds: 340, gminy: 25, podlaskie: { bots: 60, finds: 12, gminy: 30 } },
    });
    mockRpc.handlers.dev_refresh_rankings = () => ({ data: { computedAt: '2026-10-07T12:00:00.000Z', week: 40, season: 52, records: 9 } });
    const r = await devSeedActivity('mazowieckie', 3);
    expect(mockRpc.calls).toEqual([{ fn: 'dev_seed_activity', params: { p_voivodeship: 'mazowieckie', p_weeks: 3 } }]);
    expect(r).toEqual({
      ok: true,
      message: 'mazowieckie: grzybiarze 60 · znaleziska 340 · gminy 25 · podlaskie: grzybiarze 60 · znaleziska 12 · gminy 30 – rankingi przeliczone',
    });
    await devSeedActivity('podlaskie');
    expect(mockRpc.calls[1].params).toEqual({ p_voivodeship: 'podlaskie', p_weeks: 8 });
    expect(await devRefreshRankings()).toEqual({ ok: true, message: 'rankingi przeliczone – gminy z punktami: tydzień 40 · sezon 52 · rekordy 9' });
  });

  it('wyłączone narzędzia dev, brak funkcji na serwerze, brak sieci – czytelny komunikat', async () => {
    mockRpc.handlers.dev_seed_activity = () => ({ error: { message: 'dev_tools_disabled', code: 'P0001' } });
    expect(await devSeedActivity('podlaskie')).toMatchObject({ ok: false, message: expect.stringContaining('wyłączone na serwerze') });
    expect(await devRefreshRankings()).toMatchObject({ ok: false, message: expect.stringContaining('wgraj migrację etapu 4') });
    // Bez sieci (sesja zapisana w telefonie, RPC nie dochodzi) – błąd zamiast wyniku.
    mockRpc.online = false;
    expect(await devRefreshRankings()).toMatchObject({ ok: false, message: expect.stringContaining('Network request failed') });
  });
});
