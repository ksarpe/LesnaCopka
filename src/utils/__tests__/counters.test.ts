import { describe, expect, it } from '@jest/globals';

import {
  counterSqlKey,
  countersFromServer,
  counterValue,
  countActiveDay,
  countFind,
  countSocial,
  countTripFinish,
  countTripStart,
  EMPTY_COUNTERS,
  normalizeCounters,
  seasonOfMonth,
  seasonsCovered,
  type FindCountInput,
} from '../counters';

/** Czas lokalny (testy działają w strefie maszyny – liczniki liczą czas lokalny, jak telefon). */
const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

const find = (p: Partial<FindCountInput['find']> = {}): FindCountInput['find'] => ({
  speciesId: 'podgrzybek-brunatny',
  gminaId: 'suprasl',
  rarity: 'pospolity',
  xxl: false,
  collected: true,
  foundAt: at(2026, 10, 7),
  ...p,
});
const ctx = (p: Partial<FindCountInput> = {}): FindCountInput => ({
  find: find(),
  poisonous: false,
  gmina: { voivodeship: 'podlaskie', forest: 'Puszcza Knyszyńska' },
  homeGminaId: 'suprasl',
  tripFinds: 1,
  ...p,
});

describe('pory roku', () => {
  it('meteorologiczne pory roku i pokrycie', () => {
    expect([3, 6, 9, 12, 1, 2].map(seasonOfMonth)).toEqual(['wiosna', 'lato', 'jesien', 'zima', 'zima', 'zima']);
    expect(seasonsCovered([])).toBe(0);
    expect(seasonsCovered([7, 8, 9])).toBe(2);
    expect(seasonsCovered([1, 4, 7, 10])).toBe(4);
  });
});

describe('countFind', () => {
  it('okazy, odkrywca, miesiące, odznaki', () => {
    let c = countFind(EMPTY_COUNTERS, ctx({ find: find({ speciesId: 'borowik-szlachetny', rarity: 'epicki', xxl: true }), tripFinds: 4 }));
    expect(c).toMatchObject({ borowikiKnyszynska: 1, epicFinds: 1, rareFinds: 1, xxlFinds: 1, maxTripFinds: 4, autumnFinds: 1, awayFinds: 0 });
    expect(c.gminy).toEqual(['suprasl']);
    expect(c.voivodeships).toEqual(['podlaskie']);
    expect(c.forests).toEqual(['Puszcza Knyszyńska']);
    expect(c.months).toEqual([10]);
    c = countFind(c, ctx({ find: find({ gminaId: 'hajnowka', foundAt: at(2026, 1, 3), rarity: 'legendarny' }), gmina: { voivodeship: 'podlaskie', forest: 'Puszcza Białowieska' } }));
    expect(c).toMatchObject({ legendaryFinds: 1, epicFinds: 2, rareFinds: 2, awayFinds: 1, winterFinds: 1 });
    expect(c.gminy).toEqual(['suprasl', 'hajnowka']);
    expect(c.voivodeships).toEqual(['podlaskie']);
    expect(c.forests).toEqual(['Puszcza Knyszyńska', 'Puszcza Białowieska']);
    expect(c.months).toEqual([1, 10]);
  });

  it('trujące: tylko zdjęcie (bez borowików do odznaki i XXL), licznik zdjęć', () => {
    const c = countFind(EMPTY_COUNTERS, ctx({ find: find({ speciesId: 'muchomor-czerwony', collected: false, xxl: true }), poisonous: true }));
    expect(c).toMatchObject({ poisonPhotos: 1, xxlFinds: 0, borowikiKnyszynska: 0 });
  });

  it('sekretne: seria tego samego gatunku, 11:11, piątek 13., noc, Wigilia', () => {
    let c = EMPTY_COUNTERS;
    for (let i = 0; i < 3; i++) c = countFind(c, ctx());
    expect(c).toMatchObject({ runLength: 3, sameSpeciesRun: 3 });
    c = countFind(c, ctx({ find: find({ speciesId: 'maslak-zwyczajny' }) }));
    expect(c).toMatchObject({ runLength: 1, sameSpeciesRun: 3, runSpeciesId: 'maslak-zwyczajny' });
    expect(countFind(EMPTY_COUNTERS, ctx({ find: find({ foundAt: at(2026, 10, 7, 11, 11) }) })).findsAt1111).toBe(1);
    expect(countFind(EMPTY_COUNTERS, ctx({ find: find({ foundAt: at(2026, 10, 7, 11, 12) }) })).findsAt1111).toBe(0);
    // 13 listopada 2026 to piątek.
    const f13 = ctx({ find: find({ foundAt: at(2026, 11, 13), collected: false }), poisonous: true });
    expect(countFind(EMPTY_COUNTERS, f13).friday13Poison).toBe(1);
    expect(countFind(EMPTY_COUNTERS, { ...f13, poisonous: false }).friday13Poison).toBe(0);
    expect(countFind(EMPTY_COUNTERS, ctx({ find: find({ foundAt: at(2026, 10, 7, 23, 5) }) })).nightFinds).toBe(1);
    expect(countFind(EMPTY_COUNTERS, ctx({ find: find({ foundAt: at(2026, 10, 7, 3, 59) }) })).nightFinds).toBe(1);
    expect(countFind(EMPTY_COUNTERS, ctx({ find: find({ foundAt: at(2026, 10, 7, 4, 0) }) })).nightFinds).toBe(0);
    expect(countFind(EMPTY_COUNTERS, ctx({ find: find({ foundAt: at(2026, 12, 24) }) })).christmasFinds).toBe(1);
  });

  it('bez gminy domowej nic nie liczy się jako „poza domem”; brak gminy w katalogu – bez województwa', () => {
    const c = countFind(EMPTY_COUNTERS, ctx({ homeGminaId: undefined, gmina: undefined }));
    expect(c.awayFinds).toBe(0);
    expect(c.voivodeships).toEqual([]);
    expect(c.forests).toEqual([]);
  });
});

describe('wyprawy, seria, społeczność', () => {
  it('start przed 6:00, koniec (rekordy), nowy dzień', () => {
    expect(countTripStart(EMPTY_COUNTERS, new Date(2026, 9, 7, 5, 59)).earlyTrips).toBe(1);
    expect(countTripStart(EMPTY_COUNTERS, new Date(2026, 9, 7, 6, 0)).earlyTrips).toBe(0);
    let c = countTripFinish(EMPTY_COUNTERS, { distanceKm: 7.46, minutes: 192.7 });
    c = countTripFinish(c, { distanceKm: 3, minutes: 40 });
    expect(c).toMatchObject({ trips: 2, maxTripKm: 7.5, maxTripMin: 192 });
    c = countActiveDay(c, 3);
    c = countActiveDay(c, 1);
    expect(c).toMatchObject({ streakDays: 1, maxStreak: 3, activeDays: 2 });
  });

  it('reakcje (z cofnięciem), komentarze, znajomi, publikacje', () => {
    let c = countSocial(EMPTY_COUNTERS, 'reactionGiven');
    c = countSocial(c, 'reactionGiven');
    c = countSocial(c, 'reactionRemoved');
    c = countSocial(countSocial(countSocial(c, 'comment'), 'friend'), 'published');
    expect(c).toMatchObject({ reactionsGiven: 1, comments: 1, friends: 1, published: 1 });
    expect(countSocial(EMPTY_COUNTERS, 'reactionRemoved').reactionsGiven).toBe(0);
    expect(countSocial(EMPTY_COUNTERS, 'friendRemoved').friends).toBe(0);
  });
});

describe('zapis i serwer', () => {
  it('normalizacja starego zapisu i wartości metryk', () => {
    const c = normalizeCounters({ xxlFinds: 3, totalKm: 12.5 } as never);
    expect(c).toMatchObject({ xxlFinds: 3, totalKm: 12.5, trips: 0, gminy: [], runSpeciesId: '' });
    expect(counterValue({ gminy: ['a', 'b'] }, 'gminy')).toBe(2);
    expect(counterValue(undefined, 'trips')).toBe(0);
  });

  it('klucze SQL (enum achievement_metric / player_metrics) w obie strony', () => {
    expect(counterSqlKey('totalKm')).toBe('total_km');
    expect(counterSqlKey('findsAt1111')).toBe('finds_at_1111');
    expect(counterSqlKey('friday13Poison')).toBe('friday_13_poison');
    expect(counterSqlKey('trips')).toBe('trips');
    const server = { total_km: '196.4', finds_at_1111: 2, friday_13_poison: 1, gminy: ['suprasl'], months: [9, 10], seasons: 1, nieznany: 5 };
    const c = countersFromServer(server, { ...EMPTY_COUNTERS, runSpeciesId: 'maslak-zwyczajny', runLength: 2, trips: 99 });
    expect(c).toMatchObject({ totalKm: 196.4, findsAt1111: 2, friday13Poison: 1, gminy: ['suprasl'], months: [9, 10] });
    // Pola, których serwer nie zwrócił, zostają (bieżąca seria gatunku, liczniki spoza odpowiedzi).
    expect(c).toMatchObject({ runSpeciesId: 'maslak-zwyczajny', runLength: 2, trips: 99 });
    expect(c).not.toHaveProperty('nieznany');
    expect(c).not.toHaveProperty('seasons');
  });
});
