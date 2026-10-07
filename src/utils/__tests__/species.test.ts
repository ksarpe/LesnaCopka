/**
 * Gatunki chronione i trujące – tylko zdjęcie (utils/species.ts) i rozpiska XP (utils/xp.ts – computeFindXp).
 * Serwer liczy tak samo: claim_find w supabase/migrations/20261013100000_species_content.sql (scripts/db-test.mjs).
 */
import { describe, expect, it } from '@jest/globals';

import { isPhotoOnlySpecies, isPoisonousEdibility, isProtectedSpecies } from '../species';
import { BONUS, computeFindXp } from '../xp';

const base = {
  xxl: false,
  firstOfSpeciesInGminaToday: true,
  streakDays: 3,
  newInAtlas: false,
  speciesShortName: 'soplówka',
} as const;

describe('gatunki tylko do zdjęcia', () => {
  it('trujący albo chroniony → tylko zdjęcie', () => {
    expect(isPoisonousEdibility('trujacy')).toBe(true);
    expect(isPoisonousEdibility('smiertelny')).toBe(true);
    expect(isPoisonousEdibility('niejadalny')).toBe(false);
    expect(isProtectedSpecies({ protection: 'scisla' })).toBe(true);
    expect(isProtectedSpecies({})).toBe(false);
    expect(isPhotoOnlySpecies({ edibility: 'jadalny', protection: 'czesciowa' })).toBe(true);
    expect(isPhotoOnlySpecies({ edibility: 'smiertelny' })).toBe(true);
    expect(isPhotoOnlySpecies({ edibility: 'jadalny' })).toBe(false);
    expect(isPhotoOnlySpecies({ edibility: 'niejadalny' })).toBe(false);
  });
});

describe('computeFindXp – gatunek chroniony', () => {
  it('½ bazy + „Zostawiony w lesie – gatunek chroniony” +30, bez XXL, serii i „pierwszego w gminie”', () => {
    const r = computeFindXp({ ...base, rarity: 'legendarny', xxl: true, photoOnly: true, protectedSpecies: true, newInAtlas: true });
    expect(BONUS.leftProtected).toBe(30);
    expect(r.lines).toEqual([
      { label: 'Zdjęcie gatunku chronionego (½ bazy)', xp: 400 },
      { label: 'Zostawiony w lesie – gatunek chroniony', xp: 30 },
      { label: 'Nowy gatunek w atlasie', xp: 50 },
    ]);
    expect(r.total).toBe(480);
  });

  it('chroniony już w atlasie: ½ bazy + bonus (epicki: 150 + 30)', () => {
    const r = computeFindXp({ ...base, rarity: 'epicki', photoOnly: true, protectedSpecies: true });
    expect(r.lines.map((l) => l.label)).toEqual(['Zdjęcie gatunku chronionego (½ bazy)', 'Zostawiony w lesie – gatunek chroniony']);
    expect(r.total).toBe(180);
  });

  it('sama flaga protectedSpecies też oznacza tylko zdjęcie', () => {
    expect(computeFindXp({ ...base, rarity: 'rzadki', protectedSpecies: true }).total).toBe(60 + 30);
  });

  it('trujący bez ochrony – bez zmian (bez bonusu „Zostawiony w lesie”)', () => {
    const r = computeFindXp({ ...base, rarity: 'pospolity', photoOnly: true, newInAtlas: true });
    expect(r.lines).toEqual([
      { label: 'Zdjęcie gatunku trującego (½ bazy)', xp: 20 },
      { label: 'Nowy gatunek w atlasie', xp: 50 },
    ]);
  });
});
