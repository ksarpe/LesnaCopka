/**
 * Logika XP i poziomów – czyste funkcje (testy: src/utils/__tests__/xp.test.ts).
 *
 * xp = base(rzadkość) × (XXL ? 1.5 : 1) + bonusy
 *   bonusy: pierwszy gatunek w gminie dziś +40, seria dni +30, nowy gatunek w atlasie +50
 * Gatunki trujące: tylko zdjęcie → połowa bazowych XP (+ ewentualnie nowy gatunek w atlasie).
 * Gatunki chronione: tak samo tylko zdjęcie (½ bazy) + „Zostawiony w lesie – gatunek chroniony” +30.
 */
import type { Rarity, XpBreakdown, XpLine } from '@/types';

export const RARITY_BASE: Record<Rarity, number> = {
  pospolity: 40,
  rzadki: 120,
  epicki: 300,
  legendarny: 800,
};

export const BONUS = {
  firstInGminaToday: 40,
  streak: 30,
  newInAtlas: 50,
  /** Gatunek chroniony zostawiony w lesie (tylko zdjęcie). */
  leftProtected: 30,
} as const;

export const XXL_MULTIPLIER = 1.5;
/** Seria liczy się od 2 dni z rzędu. */
export const STREAK_MIN_DAYS = 2;

export interface FindXpInput {
  rarity: Rarity;
  xxl: boolean;
  /** Gatunek trujący – tylko zdjęcie do atlasu. */
  photoOnly?: boolean;
  /** Gatunek chroniony (Species.protection) – tylko zdjęcie + bonus za zostawienie w lesie. */
  protectedSpecies?: boolean;
  firstOfSpeciesInGminaToday: boolean;
  streakDays: number;
  newInAtlas: boolean;
  /** Np. „borowik” – do etykiety „Pierwszy borowik w gminie dziś”. */
  speciesShortName: string;
}

export function computeFindXp(input: FindXpInput): XpBreakdown {
  const base = RARITY_BASE[input.rarity];
  const lines: XpLine[] = [];
  if (input.photoOnly || input.protectedSpecies) {
    // Chroniony (także chroniony i trujący, np. borowik szatański) – etykieta „chronionego”; serwer: claim_find.
    const what = input.protectedSpecies ? 'chronionego' : 'trującego';
    lines.push({ label: `Zdjęcie gatunku ${what} (½ bazy)`, xp: Math.round(base / 2) });
    if (input.protectedSpecies) lines.push({ label: 'Zostawiony w lesie – gatunek chroniony', xp: BONUS.leftProtected });
    if (input.newInAtlas) lines.push({ label: 'Nowy gatunek w atlasie', xp: BONUS.newInAtlas });
    return { lines, total: sum(lines) };
  }
  lines.push({ label: `Bazowe XP (${input.rarity})`, xp: base });
  if (input.xxl) {
    lines.push({ label: 'Okaz XXL ×1,5', xp: Math.round(base * (XXL_MULTIPLIER - 1)) });
  }
  if (input.firstOfSpeciesInGminaToday) {
    lines.push({ label: `Pierwszy ${input.speciesShortName} w gminie dziś`, xp: BONUS.firstInGminaToday });
  }
  if (input.streakDays >= STREAK_MIN_DAYS) {
    lines.push({ label: `Seria ${input.streakDays} dni`, xp: BONUS.streak });
  }
  if (input.newInAtlas) {
    lines.push({ label: 'Nowy gatunek w atlasie', xp: BONUS.newInAtlas });
  }
  return { lines, total: sum(lines) };
}

function sum(lines: XpLine[]) {
  return lines.reduce((acc, l) => acc + l.xp, 0);
}

/** XP potrzebne, by przejść z poziomu `level` na następny. Lv 14 → 3000, Lv 15 → 3200, +200/poziom. */
export function levelThreshold(level: number): number {
  return Math.max(400, 3000 + (level - 14) * 200);
}

export interface LevelState {
  level: number;
  /** XP w obrębie bieżącego poziomu. */
  xp: number;
}

export interface ApplyXpResult extends LevelState {
  /** Poziomy osiągnięte po drodze (np. [15] albo [15, 16]). */
  levelUps: number[];
}

export function applyXp(state: LevelState, gained: number): ApplyXpResult {
  let level = state.level;
  let xp = state.xp + Math.max(0, gained);
  const levelUps: number[] = [];
  while (xp >= levelThreshold(level)) {
    xp -= levelThreshold(level);
    level += 1;
    levelUps.push(level);
  }
  return { level, xp, levelUps };
}

/** 0..1 */
export function levelProgress(state: LevelState): number {
  return Math.max(0, Math.min(1, state.xp / levelThreshold(state.level)));
}

/**
 * Tytuły co 5 poziomów (do 100). Krzywa XP się nie zmienia (levelThreshold, SQL `level_threshold`): łącznie
 * do poziomu N potrzeba 100 · (N − 1) · (N + 2) XP – Lv 50 ≈ 255 tys., Lv 100 ≈ 1 mln (wiele sezonów).
 */
export const LEVEL_TITLES: readonly { from: number; title: string }[] = [
  { from: 1, title: 'Początkujący Grzybiarz' },
  { from: 5, title: 'Leśny Zbieracz' },
  { from: 10, title: 'Tropiciel Borowików' },
  { from: 15, title: 'Łowca Okazów' },
  { from: 20, title: 'Strażnik Puszczy' },
  { from: 25, title: 'Mistrz Grzybobrania' },
  { from: 30, title: 'Znawca Grzybni' },
  { from: 35, title: 'Wędrowiec Borów' },
  { from: 40, title: 'Zaklinacz Kurek' },
  { from: 45, title: 'Pan Podgrzybków' },
  { from: 50, title: 'Mędrzec Lasu' },
  { from: 55, title: 'Władca Kani' },
  { from: 60, title: 'Kronikarz Puszczy' },
  { from: 65, title: 'Opiekun Grzybowisk' },
  { from: 70, title: 'Leśny Druid' },
  { from: 75, title: 'Książę Rydzów' },
  { from: 80, title: 'Król Borowików' },
  { from: 85, title: 'Pogromca Sobowtórów' },
  { from: 90, title: 'Legenda Lasu' },
  { from: 95, title: 'Duch Puszczy' },
  { from: 100, title: 'Arcymistrz Grzybobrania' },
];

export function levelTitle(level: number): string {
  let title = LEVEL_TITLES[0].title;
  for (const t of LEVEL_TITLES) if (level >= t.from) title = t.title;
  return title;
}

/** Wyróżnienie odznaki poziomu w profilu: złota od Lv 50, diamentowa od Lv 100. */
export type LevelPrestige = 'zloto' | 'diament' | null;

export function levelPrestige(level: number): LevelPrestige {
  if (level >= 100) return 'diament';
  if (level >= 50) return 'zloto';
  return null;
}

/** Okaz XXL: wyraźnie większy niż typowy dla gatunku. */
export function isXxl(weightG: number, typicalWeightG: number): boolean {
  return weightG >= typicalWeightG * 1.25;
}
