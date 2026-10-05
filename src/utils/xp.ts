/**
 * Logika XP i poziomów – czyste funkcje (testy: src/utils/__tests__/xp.test.ts).
 *
 * xp = base(rzadkość) × (XXL ? 1.5 : 1) + bonusy
 *   bonusy: pierwszy gatunek w gminie dziś +40, seria dni +30, nowy gatunek w atlasie +50
 * Gatunki trujące: tylko zdjęcie → połowa bazowych XP (+ ewentualnie nowy gatunek w atlasie).
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
} as const;

export const XXL_MULTIPLIER = 1.5;
/** Seria liczy się od 2 dni z rzędu. */
export const STREAK_MIN_DAYS = 2;

export interface FindXpInput {
  rarity: Rarity;
  xxl: boolean;
  /** Gatunek trujący – tylko zdjęcie do atlasu. */
  photoOnly?: boolean;
  firstOfSpeciesInGminaToday: boolean;
  streakDays: number;
  newInAtlas: boolean;
  /** Np. „borowik” – do etykiety „Pierwszy borowik w gminie dziś”. */
  speciesShortName: string;
}

export function computeFindXp(input: FindXpInput): XpBreakdown {
  const base = RARITY_BASE[input.rarity];
  const lines: XpLine[] = [];
  if (input.photoOnly) {
    lines.push({ label: 'Zdjęcie gatunku trującego (½ bazy)', xp: Math.round(base / 2) });
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

export function levelTitle(level: number): string {
  if (level >= 25) return 'Mistrz Grzybobrania';
  if (level >= 20) return 'Strażnik Puszczy';
  if (level >= 15) return 'Łowca Okazów';
  if (level >= 10) return 'Tropiciel Borowików';
  if (level >= 5) return 'Leśny Zbieracz';
  return 'Początkujący Grzybiarz';
}

/** Okaz XXL: wyraźnie większy niż typowy dla gatunku. */
export function isXxl(weightG: number, typicalWeightG: number): boolean {
  return weightG >= typicalWeightG * 1.25;
}
