/**
 * Losowanie gatunku w mocku rozpoznawania – czyste funkcje (testy: ./__tests__/identifyPick.test.ts).
 * Waga gatunku = rzadkość × sezon bieżącego miesiąca (`Species.seasonWeights`), więc skan w październiku daje
 * jesienne gatunki, a w kwietniu – smardze i piestrzenice. Losowość z seeda (mulberry32) – deterministyczna.
 */
import type { Rarity, Species } from '@/types';

export const RARITY_WEIGHTS: Record<Rarity, number> = { pospolity: 60, rzadki: 26, epicki: 10, legendarny: 4 };

/** Waga sezonu gatunku w miesiącu `month` (0 = styczeń). Brak danych sezonu = 1 (bez wpływu). */
export function seasonFactor(s: Pick<Species, 'seasonWeights'>, month: number): number {
  const w = s.seasonWeights;
  if (!w || w.length !== 12) return 1;
  return Math.max(0, Math.min(1, w[((month % 12) + 12) % 12] ?? 0));
}

/** Waga losowania: rzadkość × sezon (`rarity: false` – tylko sezon, np. wymuszony skan trującego gatunku). */
export function pickWeight(s: Pick<Species, 'rarity' | 'seasonWeights'>, month: number, rarity = true): number {
  return (rarity ? RARITY_WEIGHTS[s.rarity] : 1) * seasonFactor(s, month);
}

/**
 * Gatunek z puli ważony rzadkością i sezonem. Gdy w danym miesiącu nic z puli nie owocnikuje (suma wag 0),
 * decyduje sama rzadkość – rozpoznanie zawsze coś zwraca.
 */
export function pickSpecies<T extends Pick<Species, 'rarity' | 'seasonWeights'>>(
  rnd: () => number,
  pool: T[],
  month: number,
  opts?: { rarity?: boolean },
): T {
  const useRarity = opts?.rarity ?? true;
  let weights = pool.map((s) => pickWeight(s, month, useRarity));
  if (weights.reduce((a, w) => a + w, 0) <= 0) weights = pool.map((s) => (useRarity ? RARITY_WEIGHTS[s.rarity] : 1));
  const total = weights.reduce((a, w) => a + w, 0);
  let x = rnd() * total;
  let last = 0;
  for (let i = 0; i < pool.length; i++) {
    if (weights[i] <= 0) continue;
    last = i;
    x -= weights[i];
    if (x <= 0) return pool[i];
  }
  return pool[last];
}
