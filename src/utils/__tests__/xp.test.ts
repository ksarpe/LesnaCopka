import { describe, expect, it } from '@jest/globals';

import { applyXp, BONUS, computeFindXp, isXxl, LEVEL_TITLES, levelPrestige, levelProgress, levelThreshold, levelTitle, RARITY_BASE } from '../xp';

const base = {
  xxl: false,
  firstOfSpeciesInGminaToday: false,
  streakDays: 0,
  newInAtlas: false,
  speciesShortName: 'borowik',
} as const;

describe('computeFindXp', () => {
  it('bazowe XP rzadkości', () => {
    expect(RARITY_BASE).toEqual({ pospolity: 40, rzadki: 120, epicki: 300, legendarny: 800 });
    expect(computeFindXp({ ...base, rarity: 'pospolity' }).total).toBe(40);
    expect(computeFindXp({ ...base, rarity: 'legendarny' }).total).toBe(800);
  });

  it('odtwarza rozpiskę z makiety (borowik rzadki XXL: 120 + 60 + 40 + 30 = 250)', () => {
    const r = computeFindXp({ ...base, rarity: 'rzadki', xxl: true, firstOfSpeciesInGminaToday: true, streakDays: 3 });
    expect(r.lines).toEqual([
      { label: 'Bazowe XP (rzadki)', xp: 120 },
      { label: 'Okaz XXL ×1,5', xp: 60 },
      { label: 'Pierwszy borowik w gminie dziś', xp: 40 },
      { label: 'Seria 3 dni', xp: 30 },
    ]);
    expect(r.total).toBe(250);
  });

  it('XXL = base × 1.5 dla każdej rzadkości', () => {
    for (const rarity of ['pospolity', 'rzadki', 'epicki', 'legendarny'] as const) {
      expect(computeFindXp({ ...base, rarity, xxl: true }).total).toBe(RARITY_BASE[rarity] * 1.5);
    }
  });

  it('bonus za nowy gatunek w atlasie', () => {
    const r = computeFindXp({ ...base, rarity: 'epicki', newInAtlas: true });
    expect(r.total).toBe(300 + BONUS.newInAtlas);
    expect(r.lines.at(-1)).toEqual({ label: 'Nowy gatunek w atlasie', xp: 50 });
  });

  it('seria liczy się od 2 dni', () => {
    expect(computeFindXp({ ...base, rarity: 'pospolity', streakDays: 1 }).total).toBe(40);
    expect(computeFindXp({ ...base, rarity: 'pospolity', streakDays: 2 }).total).toBe(70);
  });

  it('gatunek trujący: tylko zdjęcie – połowa bazy, bez XXL/serii/pierwszeństwa', () => {
    const r = computeFindXp({
      ...base,
      rarity: 'rzadki',
      photoOnly: true,
      xxl: true,
      streakDays: 5,
      firstOfSpeciesInGminaToday: true,
      newInAtlas: true,
    });
    expect(r.total).toBe(60 + 50);
    expect(r.lines).toHaveLength(2);
  });
});

describe('poziomy', () => {
  it('progi: Lv 14 → 3000, Lv 15 → 3200, dalej +200', () => {
    expect(levelThreshold(14)).toBe(3000);
    expect(levelThreshold(15)).toBe(3200);
    expect(levelThreshold(16)).toBe(3400);
    expect(levelThreshold(1)).toBe(400);
  });

  it('applyXp bez awansu', () => {
    expect(applyXp({ level: 14, xp: 2340 }, 250)).toEqual({ level: 14, xp: 2590, levelUps: [] });
  });

  it('LEVEL UP przy przekroczeniu progu (2900 + 250 → Lv 15, 150)', () => {
    expect(applyXp({ level: 14, xp: 2900 }, 250)).toEqual({ level: 15, xp: 150, levelUps: [15] });
  });

  it('dokładnie na progu też awansuje', () => {
    expect(applyXp({ level: 14, xp: 2750 }, 250)).toEqual({ level: 15, xp: 0, levelUps: [15] });
  });

  it('wiele poziomów naraz', () => {
    const r = applyXp({ level: 14, xp: 0 }, 3000 + 3200 + 10);
    expect(r).toEqual({ level: 16, xp: 10, levelUps: [15, 16] });
  });

  it('ujemne XP ignorowane', () => {
    expect(applyXp({ level: 14, xp: 100 }, -50)).toEqual({ level: 14, xp: 100, levelUps: [] });
  });

  it('postęp poziomu 0..1 (2340/3000 = 78%)', () => {
    expect(levelProgress({ level: 14, xp: 2340 })).toBeCloseTo(0.78);
    expect(levelProgress({ level: 14, xp: 99999 })).toBe(1);
  });

  it('tytuł startowego użytkownika', () => {
    expect(levelTitle(14)).toBe('Tropiciel Borowików');
  });

  it('tytuły co 5 poziomów do 100 (21 tytułów, bez powtórzeń)', () => {
    expect(LEVEL_TITLES).toHaveLength(21);
    expect(LEVEL_TITLES.map((t) => t.from)).toEqual([1, ...Array.from({ length: 20 }, (_, i) => (i + 1) * 5)]);
    expect(new Set(LEVEL_TITLES.map((t) => t.title)).size).toBe(21);
    expect(levelTitle(1)).toBe('Początkujący Grzybiarz');
    expect(levelTitle(4)).toBe('Początkujący Grzybiarz');
    expect(levelTitle(20)).toBe('Strażnik Puszczy');
    expect(levelTitle(25)).toBe('Mistrz Grzybobrania');
    expect(levelTitle(54)).toBe('Mędrzec Lasu');
    expect(levelTitle(90)).toBe('Legenda Lasu');
    expect(levelTitle(100)).toBe('Arcymistrz Grzybobrania');
    expect(levelTitle(140)).toBe('Arcymistrz Grzybobrania');
    LEVEL_TITLES.forEach((t) => expect(t.title.length).toBeLessThanOrEqual(24));
  });

  it('krzywa liniowa bez zmian (jak level_threshold w SQL): Lv 50 ≈ 255 tys. XP, Lv 100 ≈ 1 mln', () => {
    const totalTo = (n: number) => Array.from({ length: n - 1 }, (_, i) => levelThreshold(i + 1)).reduce((a, b) => a + b, 0);
    expect(totalTo(14)).toBe(20800);
    expect(totalTo(50)).toBe(100 * 49 * 52);
    expect(totalTo(100)).toBe(100 * 99 * 102);
    expect(levelThreshold(99)).toBe(20000);
  });

  it('prestiż odznaki poziomu: złota od 50, diamentowa od 100', () => {
    expect(levelPrestige(49)).toBeNull();
    expect(levelPrestige(50)).toBe('zloto');
    expect(levelPrestige(99)).toBe('zloto');
    expect(levelPrestige(100)).toBe('diament');
  });
});

describe('isXxl', () => {
  it('≥ 125% typowej wagi', () => {
    expect(isXxl(410, 320)).toBe(true);
    expect(isXxl(390, 320)).toBe(false);
  });
});
