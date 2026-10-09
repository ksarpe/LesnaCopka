import { describe, expect, it } from '@jest/globals';

import { buildVoivodeshipRanking } from '@/data/mock/gminy';
import type { AcceptedChallenge } from '@/store/useUserStore';
import type { GminaStats } from '@/types';
import {
  mapChallenge,
  mapGminaStats,
  mapPercentile,
  mapRanking,
  rankingPoints,
  rankingSub,
  reconcileGminaState,
  recordValue,
} from '../statsMap';

const NOW = new Date(2026, 9, 7, 15, 0).getTime();
const daysAgo = (d: number) => {
  const t = new Date(NOW);
  t.setDate(t.getDate() - d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

const row = (o: Record<string, unknown> = {}) => ({
  gminaId: 'suprasl',
  name: 'Supraśl',
  kind: 'miejsko-wiejska',
  powiat: 'białostocki',
  forest: 'Puszcza Knyszyńska',
  rank: 1,
  points: 18420,
  mushroomers: 1248,
  trend: 1,
  ...o,
});

describe('mapRanking', () => {
  it('wiersze jak w mockach: punkty „18 420”, podpis z kompleksem leśnym albo miejscem gminy i liczbą grzybiarzy', () => {
    const r = mapRanking(
      {
        period: 'week',
        voivodeship: 'podlaskie',
        periodStart: '2026-10-05',
        computedAt: '2026-10-07T12:07:00.000Z',
        rows: [
          row(),
          row({ gminaId: 'bialystok', name: 'Białystok', kind: 'miejska', powiat: 'Białystok', forest: null, rank: 2, points: '9310', mushroomers: 1, trend: null }),
          row({ gminaId: 'sokolka', name: 'Sokółka', kind: 'miejsko-wiejska', powiat: 'sokólski', forest: null, rank: 3, points: 120, mushroomers: 3, trend: -2 }),
          row({ gminaId: 'bielsk-podlaski-miasto', name: 'Bielsk Podlaski', kind: 'miejska', powiat: 'bielski', forest: '', rank: 4, points: 5, mushroomers: 22, trend: 0 }),
        ],
        heat: { suprasl: 4, bialystok: 3, sokolka: '2', zero: 0, wysoko: 9 },
        userContribution: 420,
        userGminaId: 'suprasl',
      },
      'week',
      'podlaskie',
    );
    expect(r.rows).toEqual([
      { gminaId: 'suprasl', rank: 1, name: 'Supraśl', sub: 'Puszcza Knyszyńska · 1 248 grzybiarzy', points: '18 420', trend: 1 },
      { gminaId: 'bialystok', rank: 2, name: 'Białystok', sub: 'miasto na prawach powiatu · 1 grzybiarz', points: '9 310', trend: null },
      { gminaId: 'sokolka', rank: 3, name: 'Sokółka', sub: 'powiat sokólski · 3 grzybiarze', points: '120', trend: -2 },
      { gminaId: 'bielsk-podlaski-miasto', rank: 4, name: 'Bielsk Podlaski', sub: 'miasto · powiat bielski · 22 grzybiarze', points: '5', trend: null },
    ]);
    // Brak wpisu = 0 (gminy bez punktów); stopnie przycięte do 1–4.
    expect(r.heat).toEqual({ suprasl: 4, bialystok: 3, sokolka: 2, wysoko: 4 });
    expect(r.mushroomers).toEqual({ suprasl: 1248, bialystok: 1, sokolka: 3, 'bielsk-podlaski-miasto': 22 });
    expect(r).toMatchObject({ period: 'week', voivodeship: 'podlaskie', userContribution: 420 });
  });

  it('podpis i punkty zgodne z generatorem mocków (ten sam format)', () => {
    const mock = buildVoivodeshipRanking(
      [{ id: 'x', name: 'X', kind: 'wiejska', powiat: 'sokólski', forestPct: 30, mushroomers: 640 }],
      'week',
    ).rows[0];
    const points = Number(mock.points.replace(/\s/g, ''));
    expect(rankingSub({ kind: 'wiejska', powiat: 'sokólski', mushroomers: 640 })).toBe(mock.sub);
    expect(rankingPoints('week', points)).toBe(mock.points);
    expect(rankingPoints('records', 42)).toBe('42 rek.');
    expect(rankingPoints('records', 1234)).toBe('1 234 rek.');
  });

  it('rekordy: „N rek.”; pusta / uszkodzona odpowiedź → pusty ranking, sortowanie po miejscu', () => {
    const rec = mapRanking({ period: 'records', rows: [row({ rank: 2, gminaId: 'b', points: 17 }), row({ rank: 1, points: 42 })] }, 'records', 'mazowieckie');
    expect(rec.rows.map((x) => [x.rank, x.points])).toEqual([
      [1, '42 rek.'],
      [2, '17 rek.'],
    ]);
    expect(rec.voivodeship).toBe('mazowieckie');
    const empty = mapRanking({ period: 'season', rows: [], heat: {}, userContribution: null }, 'season', 'lubuskie');
    expect(empty).toEqual({ period: 'season', voivodeship: 'lubuskie', rows: [], heat: {}, mushroomers: {}, userContribution: 0 });
    expect(mapRanking(null, 'week', 'opolskie').rows).toEqual([]);
    expect(mapRanking(JSON.stringify({ rows: [row()] }), 'week', 'podlaskie').rows).toHaveLength(1);
    expect(mapRanking([{ rows: [row()] }], 'week', 'podlaskie').rows).toHaveLength(1);
  });
});

describe('mapGminaStats', () => {
  const raw = {
    gminaId: 'suprasl',
    name: 'Supraśl',
    rank: 1,
    mushroomers: 41,
    mushrooms: '312',
    species: 12,
    records: [
      { rarity: 'legendarny', speciesName: 'Szmaciak gałęzisty', weightG: 2300, capCm: 30, author: 'Ola_W', foundOn: daysAgo(12) },
      { rarity: 'epicki', speciesName: 'Borowik szlachetny', weightG: 410, capCm: 14, author: 'Marek_K', foundOn: daysAgo(1) },
      { rarity: 'rzadki', speciesName: 'Czubajka kania', weightG: null, capCm: 27, author: '', foundOn: daysAgo(0) },
      { rarity: 'dziwny', speciesName: 'Maślak', weightG: null, capCm: 8.5, author: 'Bartek', foundOn: daysAgo(21) },
      { speciesName: '' },
    ],
    distribution: [
      { name: 'Podgrzybek brunatny', pct: 38.4 },
      { name: 'Inne', pct: 18 },
      { pct: 5 },
    ],
    challenge: {
      id: 'b6f1c7c2-0000-4000-8000-000000000001',
      title: 'Znajdź szmaciaka gałęzistego',
      speciesId: 'szmaciak-galezisty',
      description: 'Tylko 4 osoby znalazły go tu w tym sezonie.',
      xp: 500,
      badgeId: 'lowca-legend',
      badgeName: 'Łowca Legend',
      endsAt: null,
    },
    challengeAccepted: true,
    challengeCompleted: false,
    followed: true,
  };

  it('rekordy: waga „2,3 kg” / „410 g”, bez wagi „Ø 27 cm”; kiedy – względnie jak w mockach', () => {
    const s = mapGminaStats(raw, 'suprasl', NOW);
    expect(s.records).toEqual([
      { rarity: 'legendarny', speciesName: 'Szmaciak gałęzisty', value: '2,3 kg', author: 'Ola_W', when: '12 dni temu' },
      { rarity: 'epicki', speciesName: 'Borowik szlachetny', value: '410 g', author: 'Marek_K', when: 'wczoraj' },
      { rarity: 'rzadki', speciesName: 'Czubajka kania', value: 'Ø 27 cm', author: 'Grzybiarz', when: 'dziś' },
      { rarity: 'pospolity', speciesName: 'Maślak', value: 'Ø 8,5 cm', author: 'Bartek', when: '3 tyg. temu' },
    ]);
    expect(s.distribution).toEqual([
      { name: 'Podgrzybek brunatny', pct: 38 },
      { name: 'Inne', pct: 18 },
    ]);
    expect(s).toMatchObject({
      gminaId: 'suprasl',
      name: 'Supraśl',
      rank: 1,
      mushroomers: 41,
      mushrooms: 312,
      species: 12,
      challengeAccepted: true,
      challengeCompleted: false,
      followed: true,
    });
    expect(s.challenge).toEqual({
      id: 'b6f1c7c2-0000-4000-8000-000000000001',
      title: 'Znajdź szmaciaka gałęzistego',
      speciesId: 'szmaciak-galezisty',
      description: 'Tylko 4 osoby znalazły go tu w tym sezonie.',
      xp: 500,
      badgeId: 'lowca-legend',
      badgeName: 'Łowca Legend',
    });
  });

  it('gmina bez danych: bez miejsca, pustych rekordów i rozkładu, bez wyzwania (tablica z jednym wierszem też)', () => {
    const s = mapGminaStats(
      [{ gminaId: 'lubien', name: 'Lubień', rank: null, mushroomers: 0, mushrooms: 0, species: 0, records: [], distribution: [], challenge: null }],
      'lubien',
      NOW,
    );
    expect(s).toEqual({
      gminaId: 'lubien',
      name: 'Lubień',
      rank: null,
      mushroomers: 0,
      mushrooms: 0,
      species: 0,
      records: [],
      distribution: [],
      challenge: null,
      challengeAccepted: false,
      challengeCompleted: false,
      followed: false,
    });
    expect(mapGminaStats(null, 'x', NOW)).toMatchObject({ gminaId: 'x', rank: null, records: [], challenge: null });
  });

  it('wyzwanie bez odznaki i z terminem', () => {
    expect(mapChallenge({ id: 'c', title: 'T', speciesId: 's', description: 'D', xp: '300', badgeId: null, badgeName: null, endsAt: '2026-10-31T22:59:59.000Z' })).toEqual({
      id: 'c',
      title: 'T',
      speciesId: 's',
      description: 'D',
      xp: 300,
      endsAt: '2026-10-31T22:59:59.000Z',
    });
    expect(mapChallenge({ title: 'bez id' })).toBeNull();
    expect(recordValue({ weightG: 0, capCm: 0 })).toBe('');
    expect(recordValue({ weightG: 980 })).toBe('980 g');
  });
});

describe('mapPercentile', () => {
  it('przepisuje pola i przycina zakresy; collected 0 = brak danych w gminie', () => {
    expect(
      mapPercentile({ speciesId: 'borowik-szlachetny', gminaId: 'suprasl', collected: 312, mushroomers: 41, sizeRank: 4, percentile: 88, biggerCount: 3 }, {
        speciesId: 'borowik-szlachetny',
        gminaId: 'suprasl',
      }),
    ).toEqual({ speciesId: 'borowik-szlachetny', gminaId: 'suprasl', collected: 312, mushroomers: 41, sizeRank: 4, percentile: 88, biggerCount: 3 });
    expect(mapPercentile([{ collected: 0, mushroomers: 0, sizeRank: 1, percentile: 100, biggerCount: 0 }], { speciesId: 'a', gminaId: 'b' })).toEqual({
      speciesId: 'a',
      gminaId: 'b',
      collected: 0,
      mushroomers: 0,
      sizeRank: 1,
      percentile: 100,
      biggerCount: 0,
    });
    expect(mapPercentile({ percentile: 140, sizeRank: 0, biggerCount: -1 }, { speciesId: 'a', gminaId: 'b' })).toMatchObject({
      percentile: 100,
      sizeRank: 1,
      biggerCount: 0,
      collected: 0,
    });
  });

  it('k-anonimowość: comparable false → kształt „brak danych” (bez porównania); comparable true zostaje', () => {
    expect(
      mapPercentile({ speciesId: 'a', gminaId: 'b', collected: 4, mushroomers: 2, sizeRank: 2, percentile: 50, biggerCount: 1, comparable: false }, {
        speciesId: 'a',
        gminaId: 'b',
      }),
    ).toEqual({ speciesId: 'a', gminaId: 'b', collected: 0, mushroomers: 0, sizeRank: 1, percentile: 100, biggerCount: 0, comparable: false });
    expect(
      mapPercentile({ collected: 9, mushroomers: 4, sizeRank: 2, percentile: 70, biggerCount: 1, comparable: true }, { speciesId: 'a', gminaId: 'b' }),
    ).toMatchObject({ collected: 9, comparable: true });
  });
});

describe('reconcileGminaState', () => {
  const ch = { id: 'ch-1', title: 'T', speciesId: 's', description: 'D', xp: 500 };
  const stats = (o: Partial<GminaStats> = {}): GminaStats => ({
    gminaId: 'suprasl',
    rank: 1,
    mushroomers: 1,
    mushrooms: 1,
    species: 1,
    records: [],
    distribution: [],
    challenge: ch,
    challengeAccepted: false,
    challengeCompleted: false,
    followed: false,
    ...o,
  });
  const accepted: AcceptedChallenge = { ...ch, gminaId: 'suprasl', acceptedAt: '2026-10-07T10:00:00.000Z' };
  const none = { follow: false, accept: false };

  it('serwer wygrywa, gdy w kolejce nic nie czeka', () => {
    expect(reconcileGminaState({ followedGminy: ['hajnowka'], challenges: [] }, stats({ followed: true, challengeAccepted: true }), none, NOW)).toEqual({
      followedGminy: ['hajnowka', 'suprasl'],
      challenges: [{ ...accepted, acceptedAt: new Date(NOW).toISOString() }],
    });
    expect(reconcileGminaState({ followedGminy: ['suprasl'], challenges: [accepted] }, stats(), none, NOW)).toEqual({
      followedGminy: [],
      challenges: [],
    });
    expect(reconcileGminaState({ followedGminy: ['suprasl'], challenges: [accepted] }, stats({ followed: true, challengeAccepted: true }), none)).toBeNull();
  });

  it('czekające w kolejce zmiany gracza mają pierwszeństwo; ukończonego wyzwania nie dokładamy; mocki (bez pól) – bez zmian', () => {
    expect(reconcileGminaState({ followedGminy: ['suprasl'], challenges: [accepted] }, stats(), { follow: true, accept: true })).toBeNull();
    expect(reconcileGminaState({ followedGminy: [], challenges: [] }, stats({ challengeAccepted: true, challengeCompleted: true }), none)).toBeNull();
    const mock = stats({ challengeAccepted: undefined, challengeCompleted: undefined, followed: undefined });
    expect(reconcileGminaState({ followedGminy: ['suprasl'], challenges: [accepted] }, mock, none)).toBeNull();
  });
});
