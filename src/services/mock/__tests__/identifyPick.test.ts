/**
 * Mock rozpoznawania: gatunek ważony rzadkością i sezonem bieżącego miesiąca (./identifyPick.ts).
 */
import { describe, expect, it } from '@jest/globals';

import { SPECIES } from '../../../data/mock/species';
import { mulberry32 } from '../../../utils/random';
import { pickSpecies, pickWeight, seasonFactor } from '../identifyPick';

const OCT = 9;
const APR = 3;

/** Rozkład 2000 losowań (seed jak w mocku: 1000 + seq × 7919). */
function sample(month: number, n = 2000) {
  const counts = new Map<string, number>();
  for (let seq = 1; seq <= n; seq++) {
    const s = pickSpecies(mulberry32(1000 + seq * 7919), SPECIES, month);
    counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  }
  return counts;
}

const species = (id: string) => SPECIES.find((s) => s.id === id)!;

describe('pickSpecies (mock rozpoznawania)', () => {
  it('waga = rzadkość × sezon miesiąca; brak danych sezonu nie zmienia wagi', () => {
    expect(seasonFactor({ seasonWeights: undefined }, OCT)).toBe(1);
    expect(seasonFactor({ seasonWeights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0] }, OCT)).toBe(0.5);
    expect(pickWeight({ rarity: 'rzadki', seasonWeights: undefined }, OCT)).toBe(26);
    expect(pickWeight(species('smardz-jadalny'), OCT)).toBe(0);
  });

  it('październik: tylko gatunki owocnikujące w październiku, głównie w pełni sezonu', () => {
    const counts = sample(OCT);
    let inSeason = 0;
    let total = 0;
    counts.forEach((n, id) => {
      const w = species(id).seasonWeights![OCT];
      expect(w).toBeGreaterThan(0);
      total += n;
      if (w >= 0.5) inSeason += n;
    });
    expect(inSeason / total).toBeGreaterThan(0.85);
    expect(counts.get('smardz-jadalny') ?? 0).toBe(0);
    expect(counts.get('podgrzybek-brunatny') ?? 0).toBeGreaterThan(0);
  });

  it('kwiecień: wiosenne gatunki (smardze, piestrzenice), bez podgrzybków i kurek', () => {
    const counts = sample(APR);
    const spring = ['smardz-jadalny', 'piestrzenica-kasztanowata', 'smardz-stozkowaty', 'zagiew-luskowata'];
    expect(spring.reduce((a, id) => a + (counts.get(id) ?? 0), 0)).toBeGreaterThan(0);
    expect(counts.get('podgrzybek-brunatny') ?? 0).toBe(0);
    expect(counts.get('pieprznik-jadalny') ?? 0).toBe(0);
  });

  it('deterministyczny dla tego samego seeda; pula bez sezonu w danym miesiącu → decyduje rzadkość', () => {
    const a = pickSpecies(mulberry32(42), SPECIES, OCT);
    const b = pickSpecies(mulberry32(42), SPECIES, OCT);
    expect(a.id).toBe(b.id);
    const offSeason = [species('smardz-jadalny'), species('piestrzenica-kasztanowata')];
    expect(offSeason.map((s) => s.id)).toContain(pickSpecies(mulberry32(7), offSeason, OCT).id);
  });

  it('wymuszony skan trującego gatunku: tylko sezon (bez wagi rzadkości)', () => {
    const poison = SPECIES.filter((s) => s.edibility === 'trujacy' || s.edibility === 'smiertelny');
    for (let i = 0; i < 200; i++) {
      const s = pickSpecies(mulberry32(i + 1), poison, OCT, { rarity: false });
      expect(s.seasonWeights![OCT]).toBeGreaterThan(0);
    }
  });
});
