import { describe, expect, it } from '@jest/globals';

import type { Gmina } from '../../../types';
import { computeChances } from '../../../utils/chances';
import { MIN_SPECIES_FINDERS, MIN_TOTAL_FINDS, mockEvidence, mockSpeciesMap, mockSpeciesShares } from '../chances';
import { buildGminaStats, GMINY } from '../gminy';
import { SPECIES } from '../species';

const suprasl = { ...GMINY.find((g) => g.id === 'suprasl')!, forestPct: 60 };
const OCT = '2026-10-07';

describe('mockSpeciesShares – zgodne z „Co tu się zbiera”', () => {
  it('sezon: 4 gatunki z rozkładu gminy w tych samych proporcjach, „Inne” na resztę katalogu; suma 1', () => {
    const shares = mockSpeciesShares(suprasl, SPECIES);
    const sum = [...shares.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // Supraśl z makiety: podgrzybek 38%, borowik 21%, kurka 14%, maślak 9%, inne 18%.
    expect(shares.get('podgrzybek-brunatny')).toBeCloseTo(0.38, 6);
    expect(shares.get('borowik-szlachetny')).toBeCloseTo(0.21, 6);
    expect(shares.get('pieprznik-jadalny')).toBeCloseTo(0.14, 6);
    expect(shares.get('maslak-zwyczajny')).toBeCloseTo(0.09, 6);
    const others = SPECIES.filter((s) => !['podgrzybek-brunatny', 'borowik-szlachetny', 'pieprznik-jadalny', 'maslak-zwyczajny'].includes(s.id));
    expect(others.reduce((a, s) => a + (shares.get(s.id) ?? 0), 0)).toBeCloseTo(0.18, 6);
  });

  it('w oknie (dzień) gatunki po szczycie słabną, a zima prawie zeruje „Inne” poza sezonem', () => {
    const oct = mockSpeciesShares(suprasl, SPECIES, OCT);
    const season = mockSpeciesShares(suprasl, SPECIES);
    expect([...oct.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Podgrzybek ma szczyt jesienią – w październiku jego udział nie spada względem sezonu.
    expect(oct.get('podgrzybek-brunatny')!).toBeGreaterThanOrEqual(season.get('podgrzybek-brunatny')! * 0.9);
  });
});

describe('mockEvidence – zbiory gminy z 14 dni', () => {
  it('deterministyczne (gmina × tydzień) i spójne z rozkładem gminy: podgrzybek najczęstszy w Supraślu', () => {
    const a = mockEvidence(suprasl, SPECIES, OCT);
    expect(mockEvidence(suprasl, SPECIES, OCT)).toEqual(a);
    expect(a.gminaId).toBe('suprasl');
    expect(a.days).toBe(14);
    expect(a.total).toBeGreaterThan(300);
    expect(a.species[0].speciesId).toBe('podgrzybek-brunatny');
    // Lista od najczęstszego, total ≥ suma listy (gatunki ukryte są tylko w total).
    expect(a.species.map((s) => s.finds)).toEqual([...a.species.map((s) => s.finds)].sort((x, y) => y - x));
    expect(a.total).toBeGreaterThanOrEqual(a.species.reduce((s, x) => s + x.finds, 0));
  });

  it('k-anonimowość jak na serwerze: na liście tylko gatunki z ≥ 2 znalazcami, znalazców ≤ znalezisk', () => {
    for (const g of GMINY.slice(0, 12)) {
      const ev = mockEvidence(g, SPECIES, OCT);
      for (const s of ev.species) {
        expect(s.finders).toBeGreaterThanOrEqual(MIN_SPECIES_FINDERS);
        expect(s.finders).toBeLessThanOrEqual(s.finds);
      }
    }
  });

  it('zimą (mało znalezisk) – próg prywatności gminy: pusta odpowiedź', () => {
    const small: Gmina = { id: 'mala-gmina', name: 'Mała', voivodeship: 'podlaskie', mushroomers: 40, forestPct: 10 };
    const ev = mockEvidence(small, SPECIES, '2026-01-20');
    expect(ev.total).toBe(0);
    expect(ev.species).toEqual([]);
    expect(MIN_TOTAL_FINDS).toBeGreaterThan(0);
  });

  it('model z danymi z mocka: Supraśl w październiku – podgrzybek i borowik w czołówce, wyżej niż bez danych', () => {
    const ev = mockEvidence(suprasl, SPECIES, OCT);
    const withData = computeChances({ gminaId: 'suprasl', species: SPECIES, forestPct: 60, evidence: ev, date: OCT, forecast: { score: 4, daysAfterRain: 2 } });
    const top3 = withData.species.slice(0, 3).map((x) => x.speciesId);
    expect(top3).toContain('podgrzybek-brunatny');
    expect(top3).toContain('borowik-szlachetny');
    expect(withData.species[0].local).toBe(true);
  });
});

describe('mockSpeciesMap', () => {
  const gminy = GMINY.map((g) => ({ ...g, forestPct: 40 }));

  it('deterministyczna; stopnie 1–4 tylko dla gmin z danymi; top 5 od największej liczby; suma pokazanych', () => {
    const m = mockSpeciesMap('borowik-szlachetny', 'podlaskie', gminy, SPECIES, OCT, 'season');
    expect(mockSpeciesMap('borowik-szlachetny', 'podlaskie', gminy, SPECIES, OCT, 'season')).toEqual(m);
    expect(m.speciesId).toBe('borowik-szlachetny');
    expect(m.period).toBe('season');
    const levels = Object.values(m.heat);
    expect(levels.length).toBeGreaterThan(5);
    expect(levels.every((l) => l >= 1 && l <= 4)).toBe(true);
    expect(levels).toContain(4);
    expect(m.top.length).toBe(5);
    expect(m.top.map((t) => t.finds)).toEqual([...m.top.map((t) => t.finds)].sort((a, b) => b - a));
    expect(m.top.every((t) => m.heat[t.gminaId] >= 1 && t.name)).toBe(true);
    expect(m.heat[m.top[0].gminaId]).toBe(4);
    expect(m.total).toBeGreaterThanOrEqual(m.top.reduce((a, t) => a + t.finds, 0));
  });

  it('tydzień ma mniej znalezisk niż sezon; gatunek legendarny – rzadko na mapie', () => {
    const season = mockSpeciesMap('podgrzybek-brunatny', 'podlaskie', gminy, SPECIES, OCT, 'season');
    const week = mockSpeciesMap('podgrzybek-brunatny', 'podlaskie', gminy, SPECIES, OCT, 'week');
    expect(week.total).toBeLessThan(season.total);
    const legend = mockSpeciesMap('szmaciak-galezisty', 'podlaskie', gminy, SPECIES, OCT, 'week');
    expect(Object.keys(legend.heat).length).toBeLessThan(Object.keys(week.heat).length);
  });

  it('podgrzybek najczęściej tam, gdzie gmina zbiera najwięcej (spójne z buildGminaStats)', () => {
    const m = mockSpeciesMap('podgrzybek-brunatny', 'podlaskie', gminy, SPECIES, OCT, 'season');
    const biggest = [...gminy].sort((a, b) => buildGminaStats(b, 0).mushrooms - buildGminaStats(a, 0).mushrooms).slice(0, 8).map((g) => g.id);
    expect(biggest).toContain(m.top[0].gminaId);
  });
});
