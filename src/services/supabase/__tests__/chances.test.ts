/**
 * Szanse i mapa gatunku w StatsService (Supabase) z atrapą klienta: wywołania RPC (kontrakt z docs/backend.md),
 * model liczony w telefonie, pamięć 10 min, brak sieci. Mapowanie pól – chancesMap.test.ts.
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
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]), gminaIndex: () => Promise.reject(new Error('brak indeksu')) }));
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

const { createSupabaseStats } = require('../stats') as typeof import('../stats');
const { backendStatus } = require('../status') as typeof import('../status');
const { ServiceError } = require('../../types') as typeof import('../../types');
/* eslint-enable @typescript-eslint/no-require-imports */

const evidence = {
  gminaId: 'suprasl',
  days: 14,
  total: 120,
  species: [
    { speciesId: 'podgrzybek-brunatny', finds: 60, finders: 14 },
    { speciesId: 'borowik-szlachetny', finds: 25, finders: 8 },
    { speciesId: 'muchomor-czerwony', finds: 9, finders: 1 },
  ],
};

beforeEach(() => {
  mockRpc.reset();
  backendStatus().set({ state: 'online', userId: 'me', error: null });
});

describe('getSpeciesChances (Supabase)', () => {
  it('get_gmina_species_evidence(p_gmina_id, p_days 14) → model w telefonie; zbiory w pamięci (Dziś / Ten tydzień bez nowego RPC)', async () => {
    const stats = createSupabaseStats();
    mockRpc.handlers.get_gmina_species_evidence = () => ({ data: evidence });
    const day = await stats.getSpeciesChances('suprasl', '2026-10-07', { forecast: { score: 4, daysAfterRain: 2 } });
    expect(mockRpc.calls).toEqual([{ fn: 'get_gmina_species_evidence', params: { p_gmina_id: 'suprasl', p_days: 14 } }]);
    expect(day.gminaId).toBe('suprasl');
    expect(day.date).toBe('2026-10-07');
    expect(day.horizon).toBe('day');
    expect(day.forecastScore).toBe(4);
    expect(day.evidenceTotal).toBe(120);
    expect(day.species[0].speciesId).toBe('podgrzybek-brunatny');
    expect(day.species[0].local).toBe(true);
    // Gatunek z 1 znalazcą (k-anonimowość) nie jest „lokalny” – jego znaleziska są tylko w total.
    expect(day.species.find((x) => x.speciesId === 'muchomor-czerwony')?.local).toBe(false);
    const week = await stats.getSpeciesChances('suprasl', '2026-10-07', { forecast: { score: 4, daysAfterRain: 2 }, horizon: 'week' });
    expect(week.horizon).toBe('week');
    expect(mockRpc.calls).toHaveLength(1);
  });

  it('pusty agregat (próg prywatności) → szanse z sezonu i rzadkości; bez prognozy – typowy dzień', async () => {
    const stats = createSupabaseStats();
    mockRpc.handlers.get_gmina_species_evidence = () => ({ data: { gminaId: 'cisek', days: 14, total: 0, species: [] } });
    const c = await stats.getSpeciesChances('cisek', '2026-10-07');
    expect(c.evidenceTotal).toBe(0);
    expect(c.forecastScore).toBeNull();
    expect(c.species.every((x) => !x.local)).toBe(true);
    expect(c.species.length).toBeGreaterThan(10);
  });

  it('bez sieci → ServiceError NETWORK, błąd nie zostaje w pamięci', async () => {
    const stats = createSupabaseStats();
    mockRpc.handlers.get_gmina_species_evidence = () => ({ data: evidence });
    mockRpc.online = false;
    await expect(stats.getSpeciesChances('suprasl')).rejects.toBeInstanceOf(ServiceError);
    mockRpc.online = true;
    const c = await stats.getSpeciesChances('suprasl');
    expect(c.evidenceTotal).toBe(120);
  });
});

describe('getSpeciesMap (Supabase)', () => {
  it('get_species_map(p_species_id, p_voivodeship, p_period) – domyślnie sezon; pamięć per gatunek × województwo × okres', async () => {
    const stats = createSupabaseStats();
    mockRpc.handlers.get_species_map = (p) => ({
      data: {
        speciesId: p.p_species_id,
        voivodeship: p.p_voivodeship,
        period: p.p_period,
        heat: { suprasl: 4, michalowo: 2 },
        top: [
          { gminaId: 'suprasl', name: 'Supraśl', finds: 12 },
          { gminaId: 'michalowo', name: 'Michałowo', finds: 4 },
        ],
        total: 16,
      },
    });
    const m = await stats.getSpeciesMap('borowik-szlachetny', 'podlaskie');
    expect(mockRpc.calls[0]).toEqual({
      fn: 'get_species_map',
      params: { p_species_id: 'borowik-szlachetny', p_voivodeship: 'podlaskie', p_period: 'season' },
    });
    expect(m).toMatchObject({ period: 'season', heat: { suprasl: 4, michalowo: 2 }, total: 16 });
    expect(m.top[0]).toEqual({ gminaId: 'suprasl', name: 'Supraśl', finds: 12 });
    await stats.getSpeciesMap('borowik-szlachetny', 'podlaskie', 'season');
    expect(mockRpc.calls).toHaveLength(1);
    await stats.getSpeciesMap('borowik-szlachetny', 'podlaskie', 'week');
    await stats.getSpeciesMap('borowik-szlachetny', 'mazowieckie', 'season');
    await stats.getSpeciesMap('podgrzybek-brunatny', 'podlaskie', 'season');
    expect(mockRpc.calls).toHaveLength(4);
  });

  it('błąd serwera → ServiceError z kodem; ponowienie pyta serwer od nowa', async () => {
    const stats = createSupabaseStats();
    mockRpc.handlers.get_species_map = () => ({ error: { message: 'species_not_found', code: 'P0002' } });
    await expect(stats.getSpeciesMap('nie-ma', 'podlaskie')).rejects.toBeInstanceOf(ServiceError);
    await expect(stats.getSpeciesMap('nie-ma', 'podlaskie')).rejects.toBeInstanceOf(ServiceError);
    expect(mockRpc.calls).toHaveLength(2);
  });
});
