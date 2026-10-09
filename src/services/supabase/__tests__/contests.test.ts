/**
 * ContestService na Supabase z atrapą klienta: nazwy i parametry RPC (docs/rywalizacja.md §7), polski powód odmowy
 * z `detail`, brak sieci. Mapowanie pól – contestsMap.test.ts; błędy – wspólne toServiceError (./feedMap.ts) przez serviceCall.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, unknown>;
type Res = { data?: unknown; error?: { message: string; code: string; details?: string } };

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
    const r = this.handlers[fn]?.(params) ?? { data: null };
    return r.error ? { data: null, error: r.error, status: 400 } : { data: r.data ?? null, error: null, status: 200 };
  },
};

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
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

const { createSupabaseContests } = require('../contests') as typeof import('../contests');
const { backendStatus } = require('../status') as typeof import('../status');
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  mockRpc.reset();
  backendStatus().set({ state: 'online', userId: 'me', error: null });
});

describe('ContestService (Supabase)', () => {
  it('RPC i parametry z kontraktu', async () => {
    const s = createSupabaseContests();
    expect(s.live).toBe(true);
    await s.getContestWeek();
    await s.getContestWeek('2026-09-28');
    await s.getContestBoard('2026-10-05:okaz', 'gmina');
    await s.getContestBoard('2026-10-05:okaz', 'wojewodztwo', 'mazowieckie');
    await s.getContestEligibility('f1');
    await s.enterContest('f1');
    await s.withdrawContestEntry('2026-10-05:okaz');
    await s.reportContestEntry('e1', 'reproduction');
    await s.reportContestEntry('e2');
    await s.getTrophies();
    await s.getTrophies('u2');
    expect(mockRpc.calls).toEqual([
      { fn: 'get_contest_week', params: { p_week_start: null } },
      { fn: 'get_contest_week', params: { p_week_start: '2026-09-28' } },
      { fn: 'get_contest_board', params: { p_contest_id: '2026-10-05:okaz', p_scope: 'gmina', p_scope_id: null } },
      { fn: 'get_contest_board', params: { p_contest_id: '2026-10-05:okaz', p_scope: 'wojewodztwo', p_scope_id: 'mazowieckie' } },
      { fn: 'get_contest_eligibility', params: { p_find_id: 'f1' } },
      { fn: 'enter_contest', params: { p_find_id: 'f1' } },
      { fn: 'withdraw_contest_entry', params: { p_contest_id: '2026-10-05:okaz' } },
      { fn: 'report_contest_entry', params: { p_entry_id: 'e1', p_reason: 'reproduction' } },
      { fn: 'report_contest_entry', params: { p_entry_id: 'e2', p_reason: null } },
      { fn: 'get_trophies', params: { p_user: null } },
      { fn: 'get_trophies', params: { p_user: 'u2' } },
    ]);
  });

  it('odmowa serwera (P0001) – polski powód z detail; brak walki – NOT_FOUND; brak sieci – NETWORK', async () => {
    const s = createSupabaseContests();
    mockRpc.handlers.enter_contest = () => ({
      error: { message: 'contest_closed', code: 'P0001', details: 'Walka jest już zamknięta' },
    });
    await expect(s.enterContest('f1')).rejects.toMatchObject({ code: 'SERVER', message: 'Walka jest już zamknięta' });
    mockRpc.handlers.get_contest_board = () => ({ error: { message: 'contest_not_found', code: 'P0002' } });
    await expect(s.getContestBoard('x', 'polska')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    mockRpc.handlers.get_contest_eligibility = () => ({
      error: { message: 'find_not_found', code: 'P0002', details: 'Nie znaleziono znaleziska' },
    });
    await expect(s.getContestEligibility('f9')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Nie znaleziono znaleziska',
    });
    mockRpc.handlers.report_contest_entry = () => ({
      error: { message: 'rate_limited', code: 'P0001', details: 'Za dużo zgłoszeń – spróbuj jutro' },
    });
    await expect(s.reportContestEntry('e1')).rejects.toMatchObject({
      code: 'SERVER',
      message: 'Za dużo zgłoszeń – spróbuj jutro',
    });
    mockRpc.online = false;
    await expect(s.getTrophies()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('pusty serwer – puste stany zamiast błędów', async () => {
    const s = createSupabaseContests();
    mockRpc.handlers.get_contest_board = () => ({
      data: {
        contest: { id: '2026-10-05:okaz' },
        scope: 'gmina',
        scopeId: 'suprasl',
        scopeName: 'Gmina Supraśl',
        entries: [],
        mine: null,
        total: 0,
      },
    });
    await expect(s.getContestBoard('2026-10-05:okaz', 'gmina')).resolves.toMatchObject({
      entries: [],
      mine: null,
      total: 0,
      scopeName: 'Gmina Supraśl',
    });
    await expect(s.getTrophies()).resolves.toEqual({ gold: 0, silver: 0, bronze: 0, items: [] });
  });
});
