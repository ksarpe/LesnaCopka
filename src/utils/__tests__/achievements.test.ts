import { describe, expect, it } from '@jest/globals';

import { SPECIES, START_ATLAS } from '../../data/mock/species';
import type { AtlasEntry } from '../../types';
import {
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENTS,
  achievementSummary,
  closestToNext,
  evaluateAchievements,
  formatProgress,
  metricValue,
  newlyReached,
  seedAwarded,
  tierKind,
  type AchievementInput,
} from '../achievements';

function startAtlas(): Record<string, AtlasEntry> {
  const atlas: Record<string, AtlasEntry> = {};
  Object.entries(START_ATLAS).forEach(([id, count]) => {
    atlas[id] = { count, firstFoundAt: '2026-01-01T00:00:00Z', bestCapCm: 0, bestWeightG: 0 };
  });
  atlas['borowik-szlachetny'] = { ...atlas['borowik-szlachetny'], bestCapCm: 16, bestWeightG: 520 };
  atlas['czubajka-kania'] = { ...atlas['czubajka-kania'], bestCapCm: 27, bestWeightG: 240 };
  return atlas;
}

const input = (atlas = startAtlas(), xxlFinds = 3): AchievementInput => ({ atlas, species: SPECIES, counters: { xxlFinds } });
const state = (id: string, i = input()) => evaluateAchievements(i).find((s) => s.def.id === id)!;

describe('definicje', () => {
  it('unikalne id, rosnące progi, gatunki z zestawów istnieją w katalogu', () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.tiers.length).toBeGreaterThanOrEqual(1);
      expect(a.tiers.length).toBeLessThanOrEqual(4);
      a.tiers.forEach((t, i) => {
        expect(t.xp).toBeGreaterThan(0);
        if (i > 0) expect(t.target).toBeGreaterThan(a.tiers[i - 1].target);
      });
      if (a.metric.kind === 'set') a.metric.ids.forEach((id) => expect(ids.has(id)).toBe(true));
      if (a.metric.kind === 'record') expect(ids.has(a.metric.speciesId)).toBe(true);
    }
  });

  it('cele po polsku z poprawną odmianą', () => {
    const k = ACHIEVEMENT_BY_ID.kolekcjoner;
    expect(k.goal(1)).toBe('Odkryj 1 gatunek w atlasie');
    expect(k.goal(22)).toBe('Odkryj 22 gatunki w atlasie');
    expect(k.goal(25)).toBe('Odkryj 25 gatunków w atlasie');
    expect(ACHIEVEMENT_BY_ID['pelny-koszyk'].goal(1000)).toBe('Zbierz 1000 okazów do atlasu');
  });
});

describe('postęp gracza startowego', () => {
  it('liczy metryki z atlasu', () => {
    const i = input();
    expect(metricValue({ kind: 'species' }, i)).toBe(23);
    expect(metricValue({ kind: 'specimens' }, i)).toBe(318);
    expect(metricValue({ kind: 'maxOfSpecies' }, i)).toBe(86);
    expect(metricValue({ kind: 'speciesWithCount', min: 5 }, i)).toBe(14);
    expect(metricValue({ kind: 'species', edibility: 'trujace' }, i)).toBe(3);
    // borowik↔goryczak, podgrzybek↔goryczak, gołąbek zielonawy↔muchomor zielonawy
    expect(metricValue({ kind: 'lookalikePairs' }, i)).toBe(3);
  });

  it('stopnie, postęp i podsumowanie', () => {
    expect(state('kolekcjoner')).toMatchObject({ tier: 1, value: 23, next: { target: 25 } });
    expect(state('specjalista').tier).toBe(3);
    expect(state('wielka-trojka').done).toBe(true);
    expect(state('legenda-lasu').tier).toBe(0);
    expect(state('parasol').progress).toBeCloseTo(0.9, 5);
    expect(formatProgress(state('kilogramowy-borowik'))).toBe('520 g / 1 kg');
    expect(achievementSummary(evaluateAchievements(input()))).toMatchObject({ earned: 20, total: 48 });
  });

  it('podgląd w profilu: najbliżej następnego stopnia, bez ukończonych i ukrytych sekretów', () => {
    const top = closestToNext(evaluateAchievements(input()), 3).map((s) => s.def.id);
    // Postęp w obrębie stopnia (jak pasek w wierszu): kania 27/30, kolekcjoner 13/15 do srebra, zestaw 4/5.
    expect(top).toEqual(['parasol', 'kolekcjoner', 'kurki-i-rydze']);
    expect(closestToNext(evaluateAchievements(input()), 99).some((s) => s.def.secret)).toBe(false);
  });
});

describe('nagrody', () => {
  it('stan startowy jest nagrodzony bez XP, nowe stopnie wypłacane po kolei', () => {
    const awarded = seedAwarded(input());
    expect(newlyReached(awarded, evaluateAchievements(input()))).toEqual([]);

    const atlas = startAtlas();
    atlas['borowik-krolewski'] = { count: 1, firstFoundAt: '2026-10-05T00:00:00Z', bestCapCm: 18, bestWeightG: 700 };
    atlas['soplowka-jezowata'] = { count: 1, firstFoundAt: '2026-10-05T00:00:00Z', bestCapCm: 20, bestWeightG: 600 };
    const unlocks = newlyReached(awarded, evaluateAchievements(input(atlas)));
    expect(unlocks).toContainEqual({ id: 'kolekcjoner', tier: 2, xp: 100 }); // 25 gatunków
    expect(unlocks).toContainEqual({ id: 'legenda-lasu', tier: 1, xp: 300 });
    expect(unlocks).toContainEqual({ id: 'biala-broda', tier: 1, xp: 400 });
    expect(unlocks.some((u) => u.id === 'smakosz')).toBe(false); // 20 jadalnych < 30
  });

  it('przeskok o kilka stopni naraz wypłaca każdy stopień', () => {
    const unlocks = newlyReached({}, [state('specjalista')]);
    expect(unlocks.map((u) => u.tier)).toEqual([1, 2, 3]);
    expect(unlocks.reduce((a, u) => a + u.xp, 0)).toBe(50 + 100 + 200);
  });

  it('okazy XXL z licznika', () => {
    expect(state('okazy-xxl', input(startAtlas(), 5)).tier).toBe(2);
  });
});

describe('medale', () => {
  it('kolejność stopni zależy od ich liczby', () => {
    expect([1, 2, 3, 4].map((t) => tierKind(4, t))).toEqual(['braz', 'srebro', 'zloto', 'platyna']);
    expect([1, 2, 3].map((t) => tierKind(3, t))).toEqual(['braz', 'srebro', 'zloto']);
    expect([1, 2].map((t) => tierKind(2, t))).toEqual(['srebro', 'zloto']);
    expect(tierKind(1, 1)).toBe('zloto');
  });
});
