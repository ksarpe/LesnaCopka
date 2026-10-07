/**
 * Zasady bezpieczeństwa gatunków – wspólne dla gry (src/store/game.ts), UI i testów.
 * Serwer (submit_find / claim_find) ma te same reguły: supabase/migrations/20261013100000_species_content.sql.
 */
import type { Edibility, Lookalike, Protection, Species } from '@/types';

export function isPoisonousEdibility(e: Edibility): boolean {
  return e === 'trujacy' || e === 'smiertelny';
}

/** Gatunek chroniony (rozporządzenie MŚ z 9.10.2014, Dz.U. 2014 poz. 1408) – nie zbieramy. */
export function isProtectedSpecies(s: Pick<Species, 'protection'> | undefined): boolean {
  return !!s?.protection;
}

/** Tylko zdjęcie do atlasu, nie do koszyka: gatunek trujący albo chroniony. */
export function isPhotoOnlySpecies(s: Pick<Species, 'edibility' | 'protection'>): boolean {
  return isPoisonousEdibility(s.edibility) || isProtectedSpecies(s);
}

export const PROTECTION_LABEL: Record<Protection, string> = {
  scisla: 'Ochrona ścisła',
  czesciowa: 'Ochrona częściowa',
};

const DANGER: Record<Edibility, number> = { smiertelny: 0, trujacy: 1, niejadalny: 2, jadalny: 3 };

/** Wszystkie sobowtóry gatunku (`lookalikes`, a przy starszych danych – sam `lookalike`), najgroźniejsze najpierw. */
export function speciesLookalikes(s: Pick<Species, 'lookalike' | 'lookalikes'>): Lookalike[] {
  const all = s.lookalikes?.length ? s.lookalikes : s.lookalike ? [s.lookalike] : [];
  return all
    .map((l, i) => ({ l, i }))
    .sort((a, b) => DANGER[a.l.edibility] - DANGER[b.l.edibility] || a.i - b.i)
    .map((x) => x.l);
}
