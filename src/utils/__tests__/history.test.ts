import { describe, expect, it } from '@jest/globals';

import type { Find, Species, Trip } from '@/types';
import {
  claimedFinds,
  filterFinds,
  findsSummary,
  fmtTripDay,
  groupByMonth,
  historyTrips,
  matchesSpecies,
  missingCount,
  monthTitle,
  sortFinds,
  tripMushrooms,
  tripRange,
  tripRows,
  tripSeasons,
  tripTotals,
} from '../history';

/** Czas lokalny → ISO (testy niezależne od strefy czasowej maszyny). */
const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

const find = (id: string, o: Partial<Find> = {}): Find => ({
  id,
  tripId: 't1',
  speciesId: 'maslak-zwyczajny',
  gminaId: 'suprasl',
  rarity: 'pospolity',
  confidence: 0.9,
  xxl: false,
  dimensions: { capCm: 7, heightCm: 6, weightG: 70, ageDays: 3 },
  collected: true,
  status: 'claimed',
  foundAt: at(2026, 10, 4),
  xp: { lines: [], total: 40 },
  ...o,
});

const trip = (id: string, o: Partial<Trip> = {}): Trip => ({
  id,
  gminaId: 'suprasl',
  status: 'finished',
  startedAt: at(2026, 10, 4, 7, 12),
  endedAt: at(2026, 10, 4, 10, 24),
  elapsedMs: 192 * 60000,
  segmentStartedAt: 0,
  distanceKm: 7.4,
  findIds: [],
  xp: 1280,
  hideRoute: false,
  ...o,
});

const SPECIES: Record<string, Pick<Species, 'name' | 'latin' | 'edibility'>> = {
  'maslak-zwyczajny': { name: 'Maślak zwyczajny', latin: 'Suillus luteus', edibility: 'jadalny' },
  'borowik-szlachetny': { name: 'Borowik szlachetny', latin: 'Boletus edulis', edibility: 'jadalny' },
  'goryczak-zolciowy': { name: 'Goryczak żółciowy', latin: 'Tylopilus felleus', edibility: 'niejadalny' },
  'muchomor-sromotnikowy': { name: 'Muchomor sromotnikowy', latin: 'Amanita phalloides', edibility: 'smiertelny' },
};
const speciesOf = (id: string) => SPECIES[id];

describe('miesiące', () => {
  it('nagłówek miesiąca po polsku (mianownik, wielka litera)', () => {
    expect(monthTitle(new Date(2026, 9, 4))).toBe('Październik 2026');
    expect(monthTitle(new Date(2025, 0, 31))).toBe('Styczeń 2025');
    expect(monthTitle(new Date(2026, 8, 1))).toBe('Wrzesień 2026');
  });

  it('grupy w kolejności wejścia, miesiąc liczony w czasie lokalnym, śmieci → „Bez daty”', () => {
    const items = [
      { id: 'a', at: at(2026, 10, 6) },
      { id: 'b', at: at(2026, 10, 1, 0, 5) },
      { id: 'c', at: at(2026, 9, 30, 23, 55) },
      { id: 'd', at: at(2025, 10, 12) },
      { id: 'e', at: 'nie-data' },
    ];
    const groups = groupByMonth(items, (x) => x.at);
    expect(groups.map((g) => [g.key, g.title, g.data.map((x) => x.id).join('')])).toEqual([
      ['2026-10', 'Październik 2026', 'ab'],
      ['2026-09', 'Wrzesień 2026', 'c'],
      ['2025-10', 'Październik 2025', 'd'],
      ['none', 'Bez daty', 'e'],
    ]);
    expect(groupByMonth([], () => '')).toEqual([]);
  });
});

describe('historia wypraw', () => {
  it('bez trwającej wyprawy, od najnowszej (także przy różnych formatach ISO)', () => {
    const trips = {
      a: trip('a', { startedAt: '2026-10-01T08:00:00.000Z' }),
      b: trip('b', { startedAt: '2026-10-05T08:00:00+00:00', status: 'published' }),
      c: trip('c', { startedAt: '2026-10-06T08:00:00.000Z', status: 'active' }),
      d: trip('d', { startedAt: '2025-09-20T08:00:00.000Z' }),
    };
    expect(historyTrips(trips).map((t) => t.id)).toEqual(['b', 'a', 'd']);
    expect(tripSeasons(historyTrips(trips))).toEqual([2026, 2025]);
  });

  it('zakres czasu: koniec z endedAt, a bez niego start + czas trwania', () => {
    const { start, end } = tripRange(trip('a'));
    expect([start.getHours(), start.getMinutes(), end.getHours(), end.getMinutes()]).toEqual([7, 12, 10, 24]);
    const open = tripRange(trip('b', { endedAt: undefined, elapsedMs: 90 * 60000 }));
    expect(open.end.getTime() - open.start.getTime()).toBe(90 * 60000);
  });

  it('data w wierszu: dzień tygodnia, dzień.miesiąc i godziny', () => {
    const { start, end } = tripRange(trip('a'));
    expect(fmtTripDay(start, end)).toBe('Niedziela, 4.10 · 07:12–10:24');
    expect(fmtTripDay(new Date(2026, 8, 28, 6, 5), new Date(2026, 8, 28, 9, 0))).toBe('Poniedziałek, 28.09 · 06:05–09:00');
  });

  it('grzyby wyprawy: tylko odebrane i do koszyka; najlepsze znalezisko – najrzadsze; sumy sezonu', () => {
    const finds = {
      a: find('a', { photoUri: 'file:///a.jpg' }),
      b: find('b', { speciesId: 'borowik-szlachetny', rarity: 'rzadki' }),
      c: find('c', { speciesId: 'muchomor-sromotnikowy', rarity: 'epicki', collected: false }),
      d: find('d', { status: 'pending' }),
    };
    const t1 = trip('t1', { findIds: ['a', 'b', 'c', 'd', 'gone'] });
    const t2 = trip('t2', { findIds: [], distanceKm: 2.6, xp: 120 });
    expect(tripMushrooms(t1, finds)).toBe(2);
    const rows = tripRows([t1, t2], finds);
    expect(rows.map((r) => [r.trip.id, r.mushrooms, r.best?.id])).toEqual([
      ['t1', 2, 'c'],
      ['t2', 0, undefined],
    ]);
    const totals = tripTotals(rows);
    expect(totals).toEqual({ trips: 2, km: expect.any(Number), mushrooms: 2, xp: 1400 });
    expect(totals.km).toBeCloseTo(10);
    expect(tripTotals([])).toEqual({ trips: 0, km: 0, mushrooms: 0, xp: 0 });
  });

  it('brakujące w telefonie względem licznika profilu (nigdy ujemnie)', () => {
    expect(missingCount(42, 3)).toBe(39);
    expect(missingCount(3, 3)).toBe(0);
    expect(missingCount(0, 2)).toBe(0);
  });
});

describe('dziennik znalezisk', () => {
  const finds = [
    find('maslak', { foundAt: at(2026, 10, 6), dimensions: { capCm: 7, heightCm: 6, weightG: 70, ageDays: 3 } }),
    find('borowik', {
      speciesId: 'borowik-szlachetny',
      rarity: 'rzadki',
      foundAt: at(2026, 10, 2),
      dimensions: { capCm: 14, heightCm: 17, weightG: 410, ageDays: 5 },
    }),
    find('goryczak', {
      speciesId: 'goryczak-zolciowy',
      foundAt: at(2026, 10, 4),
      dimensions: { capCm: 9, heightCm: 10, weightG: 410, ageDays: 3 },
    }),
    find('sromotnik', {
      speciesId: 'muchomor-sromotnikowy',
      rarity: 'epicki',
      collected: false,
      foundAt: at(2026, 9, 28),
      dimensions: { capCm: 10, heightCm: 12, weightG: 90, ageDays: 3 },
    }),
  ];
  const ids = (list: Find[]) => list.map((f) => f.id);

  it('tylko odebrane, od najnowszego', () => {
    const map = Object.fromEntries([...finds, find('pending', { status: 'pending', foundAt: at(2026, 10, 7) })].map((f) => [f.id, f]));
    expect(ids(claimedFinds(map))).toEqual(['maslak', 'goryczak', 'borowik', 'sromotnik']);
  });

  it('filtry: jadalne, rzadkie+, trujące (tylko zdjęcie)', () => {
    expect(ids(filterFinds(finds, 'all', '', speciesOf))).toEqual(['maslak', 'borowik', 'goryczak', 'sromotnik']);
    expect(ids(filterFinds(finds, 'edible', '', speciesOf))).toEqual(['maslak', 'borowik']);
    expect(ids(filterFinds(finds, 'rare', '', speciesOf))).toEqual(['borowik', 'sromotnik']);
    expect(ids(filterFinds(finds, 'poison', '', speciesOf))).toEqual(['sromotnik']);
    // Gatunek spoza katalogu: tylko „Wszystkie” bez wyszukiwania.
    const unknown = [find('x', { speciesId: 'nieznany' })];
    expect(ids(filterFinds(unknown, 'all', '', speciesOf))).toEqual(['x']);
    expect(ids(filterFinds(unknown, 'edible', '', speciesOf))).toEqual([]);
    expect(ids(filterFinds(unknown, 'all', 'bor', speciesOf))).toEqual([]);
  });

  it('wyszukiwanie bez polskich znaków i wielkości liter, po słowach, także po łacinie', () => {
    expect(matchesSpecies(SPECIES['goryczak-zolciowy'], 'ZOLC')).toBe(true);
    expect(matchesSpecies(SPECIES['goryczak-zolciowy'], 'żółć')).toBe(true);
    expect(matchesSpecies(SPECIES['maslak-zwyczajny'], 'maslak zw')).toBe(true);
    expect(matchesSpecies(SPECIES['maslak-zwyczajny'], 'zw maś')).toBe(true);
    expect(matchesSpecies(SPECIES['borowik-szlachetny'], 'boletus')).toBe(true);
    expect(matchesSpecies(SPECIES['borowik-szlachetny'], 'borowik kania')).toBe(false);
    expect(matchesSpecies(SPECIES['borowik-szlachetny'], '   ')).toBe(true);
    expect(ids(filterFinds(finds, 'all', 'Muchomor', speciesOf))).toEqual(['sromotnik']);
    expect(ids(filterFinds(finds, 'edible', 'muchomor', speciesOf))).toEqual([]);
  });

  it('sortowanie: najnowsze, największe (waga → kapelusz), najrzadsze (→ najnowsze); bez zmiany wejścia', () => {
    const input = [...finds];
    expect(ids(sortFinds(input, 'newest'))).toEqual(['maslak', 'goryczak', 'borowik', 'sromotnik']);
    expect(ids(sortFinds(input, 'biggest'))).toEqual(['borowik', 'goryczak', 'sromotnik', 'maslak']);
    expect(ids(sortFinds(input, 'rarest'))).toEqual(['sromotnik', 'borowik', 'maslak', 'goryczak']);
    expect(ids(input)).toEqual(['maslak', 'borowik', 'goryczak', 'sromotnik']);
  });

  it('podsumowanie: grzyby bez trujących, gatunki ze wszystkich, liczba „tylko zdjęcie”', () => {
    const list = [...finds, find('maslak2')];
    expect(findsSummary(list)).toEqual({
      mushrooms: 4,
      species: 4,
      photoOnly: 1,
      byRarity: { pospolity: 3, rzadki: 1, epicki: 1, legendarny: 0 },
    });
    expect(findsSummary([])).toEqual({ mushrooms: 0, species: 0, photoOnly: 0, byRarity: { pospolity: 0, rzadki: 0, epicki: 0, legendarny: 0 } });
  });
});
