import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// Granice PRG prosto z assets/geo (zamiast expo-asset) – prawdziwy indeks i paczki województw.
jest.mock('@/geo/assets.generated', () => {
  const codes = ['02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22', '24', '26', '28', '30', '32'];
  return {
    GMINY_INDEX_ASSET: 'gminy-index.geo',
    GMINY_SHARD_ASSETS: Object.fromEntries(codes.map((c) => [c, `gminy-${c}.geo`])),
  };
});
jest.mock('@/geo/readAssetText', () => ({
  readAssetText: async (name: string) => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'geo', name), 'utf8');
  },
}));

const geo = require('../geo') as typeof import('../geo');
const { haversineM } = require('../../../geo/track') as typeof import('../../../geo/track');
const { useSimStore } = require('../../../store/useSimStore') as typeof import('../../../store/useSimStore');
const { GMINY, HEAT_WEEK } = require('../../../data/mock/gminy') as typeof import('../../../data/mock/gminy');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('gminy spoza danych gry (mock)', () => {
  it('ranking województwa: wszystkie gminy z PRG, z grzybiarzami', async () => {
    const r = await geo.voivodeshipRanking('week', 'mazowieckie');
    expect(r.rows.length).toBeGreaterThan(300);
    expect(r.rows.map((x) => x.rank)).toEqual(r.rows.map((_, i) => i + 1));
    expect(r.rows.find((x) => x.gminaId === 'warszawa')?.sub).toContain('miasto na prawach powiatu');
    expect(Object.values(r.mushroomers).every((n) => n > 0)).toBe(true);
    // Ten sam okres – ten sam wynik (cache).
    expect(await geo.voivodeshipRanking('week', 'mazowieckie')).toBe(r);
  });

  it('dowolna gmina z PRG ma dane gry i miejsce zgodne z listą', async () => {
    const g = await geo.resolveGmina('gromadka');
    expect(g).toMatchObject({ name: 'Gromadka', voivodeship: 'dolnośląskie', powiat: 'bolesławiecki' });
    expect(g.mushroomers).toBeGreaterThan(0);
    const rank = await geo.rankInVoivodeship(g);
    const r = await geo.voivodeshipRanking('week', 'dolnośląskie');
    expect(r.rows[(rank ?? 0) - 1]?.gminaId).toBe('gromadka');
  });

  it('podlaskie z makiety na mapie PRG: wszystkie gminy, gminy gry ze wzoru makiety, reszta chłodniejsza', async () => {
    const { heat, mushroomers } = await geo.designVoivodeshipMap('week');
    expect(Object.keys(heat)).toHaveLength(119);
    expect(Object.keys(mushroomers)).toHaveLength(119);
    for (const g of GMINY) {
      expect(heat[g.id]).toBe(HEAT_WEEK[g.id]);
      expect(mushroomers[g.id]).toBe(g.mushroomers);
    }
    const game = new Set(GMINY.map((g) => g.id));
    const others = Object.entries(heat).filter(([id]) => !game.has(id));
    expect(others.length).toBe(119 - GMINY.length);
    expect(Math.max(...others.map(([, h]) => h))).toBeLessThanOrEqual(2);
    expect(others.every(([id]) => mushroomers[id] > 0)).toBe(true);
    const season = await geo.designVoivodeshipMap('season');
    expect(Object.values(season.heat).every((h) => h >= 0 && h <= 4)).toBe(true);
  });

  it('gminy z makiety bez zmian, nieznana → NOT_FOUND', async () => {
    expect((await geo.resolveGmina('suprasl')).mushroomers).toBe(1248);
    expect(await geo.rankInVoivodeship(await geo.resolveGmina('suprasl'))).toBeNull();
    await expect(geo.resolveGmina('nie-ma-takiej')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('symulowany spacer (mock watchDistance)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useSimStore.getState().reset();
    useSimStore.getState().set({ locationSource: 'sim', forcedGminaId: 'suprasl', gpsEnabled: true, timeSpeed: 10 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('dystans i punkty śladu wokół punktu symulacji; wyłączony GPS = nic', async () => {
    const calls: { km: number; p?: { lat: number; lon: number; newSegment?: boolean } }[] = [];
    const stop = geo.watchTripDistance((km, p) => calls.push({ km, p }));
    await jest.advanceTimersByTimeAsync(60_000);
    stop();
    expect(calls[0]).toMatchObject({ km: 0, p: { newSegment: true } });
    const km = calls.reduce((a, c) => a + c.km, 0);
    // 60 s × 10 przy ~4,2 km/h ≈ 0,7 km (±30%).
    expect(km).toBeGreaterThan(0.45);
    expect(km).toBeLessThan(0.95);
    const start = calls[0].p!;
    const pts = calls.filter((c) => c.p).map((c) => c.p!);
    expect(pts.length).toBe(31);
    expect(Math.max(...pts.map((p) => haversineM(start, p)))).toBeLessThan(1500);

    useSimStore.getState().set({ gpsEnabled: false });
    const more: number[] = [];
    const stop2 = geo.watchTripDistance((k) => more.push(k), { resumeFrom: pts[pts.length - 1] });
    await jest.advanceTimersByTimeAsync(20_000);
    stop2();
    expect(more).toEqual([]);
  });
});
