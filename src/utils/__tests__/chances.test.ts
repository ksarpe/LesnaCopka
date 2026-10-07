import { describe, expect, it } from '@jest/globals';

import { SPECIES } from '../../data/mock/species';
import type { GminaSpeciesEvidence, Species } from '../../types';
import {
  CHANCE_MAX,
  CHANCE_MIN,
  chanceFromExpected,
  computeChances,
  fitChanceLine,
  findsForScore,
  forestFactor,
  habitatFit,
  habitatsOf,
  inSeason,
  moistureFactor,
  peakLabel,
  projectedForecast,
  seasonActivity,
  seasonAt,
  seasonPhase,
  seasonWeightsOf,
  topChances,
  type ChanceInput,
} from '../chances';
import { createTtlCache } from '../ttlCache';

const PEAK_SEP_OCT = [0, 0, 0, 0, 0.05, 0.2, 0.5, 0.8, 1, 1, 0.4, 0];

function sp(id: string, o: Partial<Species> = {}): Species {
  return {
    id,
    name: id,
    latin: id,
    shortName: id,
    rarity: 'pospolity',
    edibility: 'jadalny',
    habitat: 'Las mieszany',
    typical: { capCm: 8, heightCm: 8, weightG: 80 },
    seasonWeights: PEAK_SEP_OCT,
    habitats: ['mieszany'],
    ...o,
  };
}

const CATALOG: Species[] = [
  sp('podgrzybek-brunatny', { habitats: ['iglasty', 'mieszany'] }),
  sp('borowik-szlachetny', { rarity: 'rzadki', habitats: ['iglasty', 'lisciasty'] }),
  sp('pieprznik-jadalny', { seasonWeights: [0, 0, 0, 0, 0, 0.6, 1, 1, 0.7, 0.35, 0.05, 0] }),
  sp('muchomor-czerwony', { edibility: 'trujacy', habitats: ['mieszany', 'lisciasty'] }),
  sp('czernidlak-kolpakowaty', { habitats: ['laka', 'park'] }),
  sp('smardz-jadalny', { rarity: 'epicki', seasonWeights: [0, 0, 0.15, 0.8, 1, 0.3, 0, 0, 0, 0, 0, 0], habitats: ['lisciasty'] }),
  sp('szmaciak-galezisty', { rarity: 'legendarny', habitats: ['iglasty'] }),
];

const OCT = '2026-10-07';
const base = (o: Partial<ChanceInput> = {}): ChanceInput => ({ gminaId: 'suprasl', species: CATALOG, forestPct: 45, date: OCT, ...o });
const chanceOf = (c: ReturnType<typeof computeChances>, id: string) => c.species.find((x) => x.speciesId === id)!;
const evidence = (species: GminaSpeciesEvidence['species'], total?: number): GminaSpeciesEvidence => ({
  gminaId: 'suprasl',
  days: 14,
  total: total ?? species.reduce((a, s) => a + s.finds, 0),
  species,
});

describe('sezon', () => {
  it('domyślna krzywa: wg rzadkości ze szczytem lip–paź, wiosenne gatunki (opis „Wiosną”) – marzec–czerwiec', () => {
    const def = seasonWeightsOf({ rarity: 'pospolity', habitat: 'Las iglasty' });
    expect(def).toHaveLength(12);
    expect(Math.max(...def)).toBe(1);
    expect(def.indexOf(1)).toBe(8); // wrzesień
    expect(def[0]).toBe(0);
    const legend = seasonWeightsOf({ rarity: 'legendarny', habitat: 'U podstawy sosen' });
    expect(legend[6]).toBeLessThan(def[6]); // węższy sezon rzadkich
    const spring = seasonWeightsOf({ rarity: 'epicki', habitat: 'Wiosną, łęgi' });
    expect(spring.indexOf(1)).toBe(4); // maj
    expect(spring[8]).toBe(0);
    // Złe dane w katalogu → domyślna krzywa.
    expect(seasonWeightsOf({ rarity: 'rzadki', habitat: 'x', seasonWeights: [1, 2, 3] })).toEqual(seasonWeightsOf({ rarity: 'rzadki', habitat: 'x' }));
    expect(seasonWeightsOf({ rarity: 'rzadki', habitat: 'x', seasonWeights: new Array(12).fill(0) })[8]).toBe(1);
    // Wartości spoza 0..1 obcięte.
    expect(Math.max(...seasonWeightsOf({ rarity: 'rzadki', habitat: 'x', seasonWeights: [...PEAK_SEP_OCT.slice(0, 11), 1.7] }))).toBe(1);
  });

  it('interpolacja między środkami miesięcy: 15 października ≈ waga października, przełom miesiąca – średnia', () => {
    const w = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0.5, 0, 0];
    expect(seasonAt(w, '2026-10-16')).toBeCloseTo(0.5, 1);
    expect(seasonAt(w, '2026-09-15')).toBeCloseTo(1, 1);
    const edge = seasonAt(w, '2026-09-30');
    expect(edge).toBeGreaterThan(0.6);
    expect(edge).toBeLessThan(0.9);
    // Przez przełom roku (grudzień ↔ styczeń).
    expect(seasonAt([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], '2026-12-31')).toBeCloseTo(1, 5);
  });

  it('szczyt, faza i „teraz w sezonie”', () => {
    expect(peakLabel(PEAK_SEP_OCT)).toBe('wrzesień–październik');
    expect(peakLabel([0, 0, 0, 0, 0, 0, 0, 0, 1, 0.5, 0, 0])).toBe('wrzesień');
    expect(peakLabel([1, 0.9, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.95])).toBe('grudzień–luty');
    expect(seasonPhase(PEAK_SEP_OCT, OCT)).toBe('peak');
    expect(seasonPhase(PEAK_SEP_OCT, '2026-02-10')).toBe('off');
    expect(seasonPhase(PEAK_SEP_OCT, '2026-07-10')).toBe('start');
    expect(seasonPhase([0, 0, 0, 0, 0, 0, 0.6, 1, 1, 0.6, 0.1, 0], '2026-10-20')).toBe('end');
    expect(inSeason(sp('a'), 10)).toBe(true);
    expect(inSeason(sp('a'), 7)).toBe(true);
    expect(inSeason(sp('a'), 6)).toBe(false);
    expect(inSeason({ rarity: 'pospolity', habitat: 'Las' }, 9)).toBe(true); // domyślna krzywa
  });
});

describe('siedlisko, lesistość, wilgoć, prognoza', () => {
  it('siedliska z katalogu albo z opisu', () => {
    expect(habitatsOf({ habitat: 'Łąki i pobocza' })).toEqual(['laka']);
    expect(habitatsOf({ habitat: 'Bory sosnowe' })).toEqual(['iglasty']);
    expect(habitatsOf({ habitat: 'Pnie i korzenie' })).toEqual(['drewno']);
    expect(habitatsOf({ habitat: 'Coś innego' })).toEqual(['mieszany']);
    expect(habitatsOf({ habitat: 'Bory', habitats: ['park'] })).toEqual(['park']);
  });

  it('gatunki leśne zyskują z lesistością, łąkowe – na terenach otwartych', () => {
    expect(habitatFit(['iglasty'], 70)).toBeGreaterThan(habitatFit(['iglasty'], 30));
    expect(habitatFit(['iglasty'], 30)).toBeGreaterThan(habitatFit(['iglasty'], 5));
    expect(habitatFit(['laka'], 5)).toBeGreaterThan(habitatFit(['laka'], 60));
    expect(habitatFit(['iglasty'], null)).toBeCloseTo(1, 5);
    expect(forestFactor(5)).toBeLessThan(forestFactor(50));
    expect(forestFactor(90)).toBe(1.15);
  });

  it('wilgoć tylko dla gatunków ją lubiących; prognoza tygodnia wraca do typowego dnia', () => {
    expect(moistureFactor('pieprznik-jadalny', { score: 4, daysAfterRain: 3 })).toBe(1.3);
    expect(moistureFactor('pieprznik-jadalny', { score: 2, daysAfterRain: null })).toBe(0.7);
    expect(moistureFactor('pieprznik-jadalny', null)).toBe(1);
    expect(moistureFactor('borowik-szlachetny', { score: 4, daysAfterRain: 3 })).toBe(1);
    expect(projectedForecast({ score: 5, daysAfterRain: 2 }, 0)).toEqual({ score: 5, daysAfterRain: 2 });
    expect(projectedForecast({ score: 5, daysAfterRain: 2 }, 2)).toEqual({ score: 4, daysAfterRain: 4 });
    expect(projectedForecast({ score: 5, daysAfterRain: 13 }, 2)?.daysAfterRain).toBeNull();
    expect(projectedForecast({ score: 5, daysAfterRain: 2 }, 4)).toBeNull();
    expect(findsForScore(1)).toBe(2);
    expect(findsForScore(5)).toBe(12);
    expect(findsForScore(3.5)).toBeCloseTo(7.75, 5);
    expect(findsForScore(9)).toBe(12);
  });

  it('aktywność sezonu: jesień ≈ 1, zima ≈ 0', () => {
    expect(seasonActivity(SPECIES, '2026-09-20')).toBeGreaterThan(0.9);
    expect(seasonActivity(SPECIES, '2026-01-15')).toBeLessThan(0.05);
  });
});

describe('computeChances', () => {
  it('szansa = 1 − e^(−λ) obcięta do 1–95%', () => {
    expect(chanceFromExpected(0)).toBe(CHANCE_MIN);
    expect(chanceFromExpected(100)).toBe(CHANCE_MAX);
    expect(chanceFromExpected(1)).toBeCloseTo(1 - Math.exp(-1), 10);
    const c = computeChances(base({ forecast: { score: 5, daysAfterRain: 4 } }));
    for (const x of c.species) {
      expect(x.chance).toBeGreaterThanOrEqual(CHANCE_MIN);
      expect(x.chance).toBeLessThanOrEqual(CHANCE_MAX);
    }
    expect(chanceOf(c, 'szmaciak-galezisty').chance).toBe(CHANCE_MIN);
    expect(chanceOf(c, 'smardz-jadalny').chance).toBe(CHANCE_MIN); // poza sezonem
  });

  it('suma λ = oczekiwane znaleziska; posortowane od najbardziej prawdopodobnego; trujące też na liście', () => {
    const c = computeChances(base({ forecast: { score: 4, daysAfterRain: 2 } }));
    const sum = c.species.reduce((a, x) => a + x.expected, 0);
    expect(sum).toBeCloseTo(c.expectedFinds, 6);
    expect(c.species.map((x) => x.expected)).toEqual([...c.species.map((x) => x.expected)].sort((a, b) => b - a));
    expect(c.species[0].speciesId).toBe('podgrzybek-brunatny');
    expect(c.species.some((x) => x.speciesId === 'muchomor-czerwony' && x.chance > 0.05)).toBe(true);
    expect(c.forecastScore).toBe(4);
    expect(c.evidenceTotal).toBe(0);
    expect(topChances(c, 2)).toHaveLength(2);
    expect(topChances(c, 3, (id) => id !== 'podgrzybek-brunatny')[0].speciesId).not.toBe('podgrzybek-brunatny');
  });

  it('monotoniczność w sezonie: wyższa waga sezonu gatunku → większa szansa', () => {
    const at = (w: number) =>
      chanceOf(
        computeChances(
          base({ species: CATALOG.map((s) => (s.id === 'borowik-szlachetny' ? { ...s, seasonWeights: PEAK_SEP_OCT.map((x, i) => (i === 9 ? w : x)) } : s)) }),
        ),
        'borowik-szlachetny',
      ).chance;
    const values = [0.1, 0.3, 0.6, 1].map(at);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    // Ten sam gatunek: październik (szczyt) > lipiec (początek) > luty (poza sezonem).
    const month = (date: string) => chanceOf(computeChances(base({ date })), 'podgrzybek-brunatny').chance;
    expect(month('2026-10-07')).toBeGreaterThan(month('2026-07-05'));
    expect(month('2026-07-05')).toBeGreaterThan(month('2026-02-10'));
  });

  it('monotoniczność w prognozie: lepsza prognoza → większe szanse wszystkich gatunków', () => {
    const scores = [1, 2, 3, 4, 5].map((score) => computeChances(base({ forecast: { score, daysAfterRain: 12 } })));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i].expectedFinds).toBeGreaterThan(scores[i - 1].expectedFinds);
      expect(chanceOf(scores[i], 'borowik-szlachetny').chance).toBeGreaterThan(chanceOf(scores[i - 1], 'borowik-szlachetny').chance);
    }
  });

  it('monotoniczność w danych z gminy: więcej znalezisk gatunku → większa szansa (wygładzenie bayesowskie)', () => {
    const withBorowik = (n: number) =>
      chanceOf(
        computeChances(base({ evidence: evidence([{ speciesId: 'podgrzybek-brunatny', finds: 60, finders: 12 }, ...(n ? [{ speciesId: 'borowik-szlachetny', finds: n, finders: 2 }] : [])]) })),
        'borowik-szlachetny',
      );
    const values = [0, 5, 20, 60].map((n) => withBorowik(n).chance);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(withBorowik(0).local).toBe(false);
    expect(withBorowik(20).local).toBe(true);
    expect(withBorowik(20).reasons[0]).toMatch(/w gminie w ostatnich 2 tyg\./);
  });

  it('dużo danych → udziały z gminy; brak danych → prior', () => {
    const data = computeChances(
      base({ evidence: evidence([{ speciesId: 'czernidlak-kolpakowaty', finds: 900, finders: 80 }, { speciesId: 'podgrzybek-brunatny', finds: 100, finders: 20 }]) }),
    );
    expect(data.species[0].speciesId).toBe('czernidlak-kolpakowaty');
    expect(data.evidenceTotal).toBe(1000);
    const prior = computeChances(base());
    expect(chanceOf(prior, 'czernidlak-kolpakowaty').chance).toBeLessThan(chanceOf(data, 'czernidlak-kolpakowaty').chance);
  });

  it('k-anonimowość: znaleziska ukryte (tylko w total) rozkładane na niewymienione gatunki wg prioru', () => {
    const listed = [{ speciesId: 'podgrzybek-brunatny', finds: 50, finders: 9 }];
    const without = computeChances(base({ evidence: evidence(listed, 50) }));
    const hidden = computeChances(base({ evidence: evidence(listed, 150) }));
    // 100 ukrytych znalezisk podnosi niewymienione gatunki względem podgrzybka.
    expect(chanceOf(hidden, 'podgrzybek-brunatny').expected).toBeLessThan(chanceOf(without, 'podgrzybek-brunatny').expected);
    expect(chanceOf(hidden, 'borowik-szlachetny').expected).toBeGreaterThan(chanceOf(without, 'borowik-szlachetny').expected);
    expect(chanceOf(hidden, 'borowik-szlachetny').local).toBe(false);
    // Pusty agregat (próg prywatności) = brak danych = sam prior.
    const empty = computeChances(base({ evidence: { gminaId: 'suprasl', days: 14, total: 0, species: [] } }));
    expect(empty.species.map((x) => x.expected)).toEqual(computeChances(base()).species.map((x) => x.expected));
    // Gatunek spoza katalogu w danych – pominięty bez błędu.
    expect(() => computeChances(base({ evidence: evidence([{ speciesId: 'nie-ma', finds: 9, finders: 3 }]) }))).not.toThrow();
  });

  it('lesistość: gatunki leśne wyżej w gminie lesistej, łąkowe – w miejskiej', () => {
    const forest = computeChances(base({ forestPct: 70 }));
    const city = computeChances(base({ forestPct: 4 }));
    expect(chanceOf(forest, 'podgrzybek-brunatny').chance).toBeGreaterThan(chanceOf(city, 'podgrzybek-brunatny').chance);
    const share = (c: ReturnType<typeof computeChances>, id: string) => chanceOf(c, id).expected / c.expectedFinds;
    expect(share(city, 'czernidlak-kolpakowaty')).toBeGreaterThan(share(forest, 'czernidlak-kolpakowaty'));
  });

  it('uzasadnienia: szczyt sezonu, po deszczu (gatunki lubiące wilgoć), legenda', () => {
    const c = computeChances(base({ date: '2026-09-20', forecast: { score: 4, daysAfterRain: 3 } }));
    expect(chanceOf(c, 'podgrzybek-brunatny').reasons).toContain('Szczyt sezonu');
    expect(chanceOf(c, 'pieprznik-jadalny').reasons).toContain('Po deszczu – lubi wilgoć');
    expect(chanceOf(c, 'borowik-szlachetny').reasons).not.toContain('Po deszczu – lubi wilgoć');
    expect(chanceOf(c, 'szmaciak-galezisty').reasons).toContain('Legenda – trafia się nielicznym');
    expect(chanceOf(computeChances(base({ date: '2026-02-10' })), 'podgrzybek-brunatny').reasons[0]).toBe('Poza sezonem');
  });

  it('„Ten tydzień”: średnia z 7 dni – świetna dziś prognoza wraca do typowego dnia', () => {
    const great = { score: 5, daysAfterRain: 4 };
    const day = computeChances(base({ forecast: great }));
    const week = computeChances(base({ forecast: great, horizon: 'week' }));
    expect(week.horizon).toBe('week');
    expect(week.expectedFinds).toBeLessThan(day.expectedFinds);
    const poor = { score: 1, daysAfterRain: null };
    expect(computeChances(base({ forecast: poor, horizon: 'week' })).expectedFinds).toBeGreaterThan(
      computeChances(base({ forecast: poor })).expectedFinds,
    );
    // Bez prognozy oba widoki ≈ typowy dzień (różnią się tylko przesunięciem sezonu).
    expect(computeChances(base({ horizon: 'week' })).expectedFinds).toBeCloseTo(computeChances(base()).expectedFinds, 0);
  });

  it('zima: prawie zero znalezisk, wszystkie szanse na minimum', () => {
    const c = computeChances(base({ species: SPECIES, date: '2026-01-15', forecast: { score: 1, daysAfterRain: null } }));
    expect(c.expectedFinds).toBeLessThan(0.2);
    expect(c.species.every((x) => x.chance <= 0.1)).toBe(true);
  });

  it('pełny katalog (mocki) – Supraśl w październiku: podgrzybek najbardziej prawdopodobny', () => {
    const c = computeChances({ gminaId: 'suprasl', species: SPECIES, forestPct: 60, date: OCT, forecast: { score: 4, daysAfterRain: 2 } });
    expect(c.species[0].speciesId).toBe('podgrzybek-brunatny');
    expect(c.expectedFinds).toBeGreaterThan(6);
    expect(c.species).toHaveLength(SPECIES.length);
  });
});

describe('fitChanceLine (Start, jedna linia)', () => {
  const items = ['podgrzybek 95%', 'borowik 81%', 'kurka 58%'];
  it('szeroko – pełne zdanie z 3 gatunkami; węziej – „Szanse tu:” i mniej gatunków; zawsze co najmniej 1', () => {
    expect(fitChanceLine(items, 500)).toEqual({ label: 'Najbardziej prawdopodobne tu: ', text: 'podgrzybek 95% · borowik 81% · kurka 58%' });
    expect(fitChanceLine(items, 340)).toEqual({ label: 'Szanse tu: ', text: 'podgrzybek 95% · borowik 81% · kurka 58%' });
    expect(fitChanceLine(items, 282)).toEqual({ label: 'Szanse tu: ', text: 'podgrzybek 95% · borowik 81%' });
    expect(fitChanceLine(items, 170)).toEqual({ label: 'Szanse tu: ', text: 'podgrzybek 95%' });
    expect(fitChanceLine(items, 40)).toEqual({ label: 'Szanse tu: ', text: 'podgrzybek 95%' });
  });
});

describe('createTtlCache', () => {
  it('jedno pobranie w czasie życia, po wygaśnięciu – nowe; błąd nie zostaje w pamięci', async () => {
    let t = 0;
    const cache = createTtlCache<number>(1000, { now: () => t });
    let calls = 0;
    const load = () => Promise.resolve(++calls);
    expect(await cache.get('a', load)).toBe(1);
    expect(await cache.get('a', load)).toBe(1);
    t = 999;
    expect(await cache.get('a', load)).toBe(1);
    t = 1000;
    expect(await cache.get('a', load)).toBe(2);
    await expect(cache.get('b', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await Promise.resolve();
    expect(await cache.get('b', load)).toBe(3);
    cache.clear();
    expect(await cache.get('a', load)).toBe(4);
  });

  it('najstarsze wpisy wypadają powyżej limitu', async () => {
    const cache = createTtlCache<string>(60_000, { max: 2 });
    let calls = 0;
    const load = (v: string) => () => Promise.resolve(`${v}${++calls}`);
    await cache.get('a', load('a'));
    await cache.get('b', load('b'));
    await cache.get('c', load('c'));
    expect(await cache.get('b', load('b'))).toBe('b2');
    expect(await cache.get('a', load('a'))).toBe('a4');
  });
});
