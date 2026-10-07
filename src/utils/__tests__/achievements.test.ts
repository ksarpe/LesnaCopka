import { describe, expect, it } from '@jest/globals';

import { SPECIES, START_ATLAS } from '../../data/mock/species';
import { START_COUNTERS } from '../../data/mock/users';
import type { AtlasEntry } from '../../types';
import {
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENTS,
  achievementSummary,
  closestToNext,
  evaluateAchievements,
  FAMILIES,
  familyTargets,
  formatProgress,
  MEDAL_ORDER,
  mergeSeedAwarded,
  metricValue,
  newlyReached,
  seedAwarded,
  tierKind,
  XP_LADDERS,
  type AchievementInput,
} from '../achievements';
import { EMPTY_COUNTERS, LIST_COUNTERS, type PlayerCounters } from '../counters';

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
const withCounters = (c: Partial<PlayerCounters>, atlas: Record<string, AtlasEntry> = {}): AchievementInput => ({
  atlas,
  species: SPECIES,
  counters: { ...EMPTY_COUNTERS, ...c },
});

describe('definicje', () => {
  it('unikalne id, 1–5 rosnących progów, gatunki z zestawów istnieją w katalogu, znane kategorie i liczniki', () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    const categories = new Set(ACHIEVEMENT_CATEGORIES.map((c) => c.id));
    const counterKeys = new Set(Object.keys(EMPTY_COUNTERS));
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(categories.has(a.category)).toBe(true);
      expect(a.tiers.length).toBeGreaterThanOrEqual(1);
      expect(a.tiers.length).toBeLessThanOrEqual(5);
      a.tiers.forEach((t, i) => {
        expect(t.xp).toBeGreaterThan(0);
        expect(t.target).toBeGreaterThan(0);
        if (i > 0) expect(t.target).toBeGreaterThan(a.tiers[i - 1].target);
      });
      if (a.metric.kind === 'set') {
        expect(a.metric.ids.length).toBeGreaterThan(0);
        a.metric.ids.forEach((id) => expect(ids.has(id)).toBe(true));
        // Zestaw nie może wymagać więcej gatunków, niż ma.
        expect(a.tiers[a.tiers.length - 1].target).toBeLessThanOrEqual(a.metric.ids.length);
      }
      if (a.metric.kind === 'record') expect(ids.has(a.metric.speciesId)).toBe(true);
      if (a.metric.kind === 'counter') expect(counterKeys.has(a.metric.counter)).toBe(true);
      expect(a.goal(a.tiers[0].target).length).toBeGreaterThan(5);
    }
  });

  it('dużo celów na długo: ok. 60 osiągnięć i ponad 200 stopni, każda kategoria niepusta, diamenty', () => {
    const total = ACHIEVEMENTS.reduce((a, d) => a + d.tiers.length, 0);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(55);
    expect(total).toBeGreaterThanOrEqual(200);
    ACHIEVEMENT_CATEGORIES.forEach((c) => expect(ACHIEVEMENTS.some((a) => a.category === c.id)).toBe(true));
    expect(ACHIEVEMENTS.filter((a) => a.tiers.length === 5).length).toBeGreaterThanOrEqual(35);
    expect(ACHIEVEMENTS.filter((a) => a.secret).length).toBeGreaterThanOrEqual(7);
  });

  it('bilans XP: stopnie rosną, diament 1000–2500 XP', () => {
    for (const a of ACHIEVEMENTS) {
      a.tiers.forEach((t, i) => i > 0 && expect(t.xp).toBeGreaterThanOrEqual(a.tiers[i - 1].xp));
      if (a.tiers.length === 5) {
        expect(a.tiers[4].xp).toBeGreaterThanOrEqual(1000);
        expect(a.tiers[4].xp).toBeLessThanOrEqual(2500);
      }
    }
    // Drabiny wg medalu: 3 stopnie = brąz, srebro, złoto (XP pierwszych trzech szczebli).
    expect(ACHIEVEMENT_BY_ID['cztery-pory-roku'].tiers.map((t) => t.xp)).toEqual(XP_LADDERS.L.slice(0, 3));
    expect(ACHIEVEMENT_BY_ID['wedrowiec'].tiers.map((t) => t.xp)).toEqual([...XP_LADDERS.M]);
  });

  it('cele po polsku z poprawną odmianą', () => {
    const k = ACHIEVEMENT_BY_ID.kolekcjoner;
    expect(k.goal(1)).toBe('Odkryj 1 gatunek w atlasie');
    expect(k.goal(22)).toBe('Odkryj 22 gatunki w atlasie');
    expect(k.goal(25)).toBe('Odkryj 25 gatunków w atlasie');
    expect(ACHIEVEMENT_BY_ID['pelny-koszyk'].goal(1000)).toBe('Zbierz 1000 okazów do atlasu');
    expect(ACHIEVEMENT_BY_ID.wedrowiec.goal(5)).toBe('Zakończ 5 wypraw');
    expect(ACHIEVEMENT_BY_ID.wedrowiec.goal(22)).toBe('Zakończ 22 wyprawy');
    expect(ACHIEVEMENT_BY_ID['seria-dni'].goal(365)).toBe('Bądź w lesie 365 dni z rzędu');
    expect(ACHIEVEMENT_BY_ID['grzybiarz-caloroczny'].goal(12)).toBe('Znajdź grzyby w każdym miesiącu roku');
    expect(ACHIEVEMENT_BY_ID['zimowy-grzybiarz'].goal(1)).toBe('Znajdź grzyba zimą (grudzień–luty)');
    expect(ACHIEVEMENT_BY_ID['darz-grzyb'].goal(10)).toBe('Daj „Darz grzyb!” 10 wyprawom innych');
    expect(ACHIEVEMENT_BY_ID['caly-dzien-w-lesie'].goal(90 + 30)).toBe('Wyprawa trwająca co najmniej 2 h');
  });

  it('rodziny z katalogu: progi ¼, ½, ¾ i całość; rosną same z katalogiem', () => {
    expect(familyTargets(9)).toEqual([3, 5, 7, 9]);
    expect(familyTargets(4)).toEqual([1, 2, 3, 4]);
    expect(familyTargets(3)).toEqual([1, 2, 3]);
    const b = ACHIEVEMENT_BY_ID.borowikowate;
    expect(b.metric).toEqual({ kind: 'set', ids: FAMILIES.borowikowate });
    expect(FAMILIES.borowikowate).toEqual(expect.arrayContaining(['borowik-szlachetny', 'podgrzybek-brunatny', 'kozlarz-babka']));
    expect(b.tiers.map((t) => t.target)).toEqual(familyTargets(FAMILIES.borowikowate.length));
    expect(b.goal(FAMILIES.borowikowate.length)).toBe(`Wszystkie borowikowate z katalogu (${FAMILIES.borowikowate.length})`);
    expect(FAMILIES.trujace.every((id) => ['trujacy', 'smiertelny'].includes(SPECIES.find((s) => s.id === id)!.edibility))).toBe(true);
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
    const sum = achievementSummary(evaluateAchievements(input()));
    expect(sum.total).toBe(ACHIEVEMENTS.reduce((a, d) => a + d.tiers.length, 0));
    expect(sum.earned).toBe(evaluateAchievements(input()).reduce((a, s) => a + s.tier, 0));
  });

  it('gracz demo z licznikami makiety: wyprawy, odkrywca, sezony, seria, społeczność', () => {
    const i: AchievementInput = { atlas: startAtlas(), species: SPECIES, counters: START_COUNTERS };
    const st = (id: string) => evaluateAchievements(i).find((s) => s.def.id === id)!;
    expect(st('wedrowiec')).toMatchObject({ value: 42, tier: 3, next: { target: 80 } });
    expect(st('lesne-kilometry')).toMatchObject({ tier: 2 });
    expect(formatProgress(st('lesne-kilometry'))).toBe('196 km / 250 km');
    expect(st('seria-dni')).toMatchObject({ value: 7, tier: 2 });
    expect(st('grzybiarz-caloroczny')).toMatchObject({ value: 6, tier: 3 });
    expect(st('cztery-pory-roku')).toMatchObject({ value: 2, tier: 1 });
    expect(st('skowronek')).toMatchObject({ value: 1, tier: 1 });
    expect(st('caly-dzien-w-lesie').value).toBe(205);
    expect(formatProgress(st('caly-dzien-w-lesie'))).toBe('3 h 25 min / 5 h');
  });

  it('podgląd w profilu: najbliżej następnego stopnia, bez ukończonych i ukrytych sekretów', () => {
    const top = closestToNext(evaluateAchievements(input()), 3).map((s) => s.def.id);
    // Postęp w obrębie stopnia (jak pasek w wierszu): kania 27/30, kolekcjoner 13/15 do srebra, zestaw 4/5.
    expect(top).toEqual(['parasol', 'kolekcjoner', 'kurki-i-rydze']);
    expect(closestToNext(evaluateAchievements(input()), 99).some((s) => s.def.secret)).toBe(false);
  });
});

describe('metryki liczników', () => {
  it('liczniki liczbowe i listy (długość); brak licznika = 0', () => {
    const i = withCounters({ trips: 16, gminy: ['suprasl', 'hajnowka', 'narewka'], months: [1, 7, 8], maxStreak: 30 });
    expect(metricValue({ kind: 'counter', counter: 'trips' }, i)).toBe(16);
    expect(metricValue({ kind: 'counter', counter: 'gminy' }, i)).toBe(3);
    expect(metricValue({ kind: 'counter', counter: 'months' }, i)).toBe(3);
    expect(metricValue({ kind: 'seasons' }, i)).toBe(2);
    expect(metricValue({ kind: 'counter', counter: 'reactionsGiven' }, { atlas: {}, species: SPECIES, counters: {} })).toBe(0);
    LIST_COUNTERS.forEach((k) => expect(Array.isArray(EMPTY_COUNTERS[k])).toBe(true));
  });

  it('nowe kategorie: stopnie z liczników', () => {
    const tierOf = (id: string, c: Partial<PlayerCounters>) => evaluateAchievements(withCounters(c)).find((s) => s.def.id === id)!.tier;
    expect(tierOf('odkrywca-gmin', { gminy: Array.from({ length: 20 }, (_, k) => `g${k}`) })).toBe(3);
    expect(tierOf('krajoznawca', { voivodeships: ['podlaskie', 'mazowieckie'] })).toBe(1);
    expect(tierOf('cztery-pory-roku', { months: [12, 4, 7, 10] })).toBe(3);
    expect(tierOf('seria-dni', { maxStreak: 365 })).toBe(5);
    expect(tierOf('darz-grzyb', { reactionsGiven: 40 })).toBe(2);
    expect(tierOf('sumienny', { dailyQuestsDone: 100 })).toBe(3);
    expect(tierOf('wyzwania-gmin', { challengesDone: 1 })).toBe(1);
    expect(tierOf('jedenasta-jedenascie', { findsAt1111: 1 })).toBe(1);
    expect(tierOf('piatek-trzynastego', { friday13Poison: 12 })).toBe(0);
    expect(tierOf('uparty-zbieracz', { sameSpeciesRun: 3 })).toBe(1);
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

  it('przeskok o kilka stopni naraz wypłaca każdy stopień – aż do diamentu', () => {
    const unlocks = newlyReached({}, [state('specjalista')]);
    expect(unlocks.map((u) => u.tier)).toEqual([1, 2, 3]);
    expect(unlocks.reduce((a, u) => a + u.xp, 0)).toBe(50 + 100 + 200);
    const all = newlyReached({ 'seria-dni': 2 }, evaluateAchievements(withCounters({ maxStreak: 400 })));
    expect(all.filter((u) => u.id === 'seria-dni')).toEqual([
      { id: 'seria-dni', tier: 3, xp: 500 },
      { id: 'seria-dni', tier: 4, xp: 1200 },
      { id: 'seria-dni', tier: 5, xp: 2500 },
    ]);
  });

  it('okazy XXL z licznika', () => {
    expect(state('okazy-xxl', input(startAtlas(), 5)).tier).toBe(2);
  });

  it('migracja: osiągnięte stopnie nowych osiągnięć bez XP, nagrodzone zostają', () => {
    const i: AchievementInput = { atlas: startAtlas(), species: SPECIES, counters: START_COUNTERS };
    const merged = mergeSeedAwarded({ kolekcjoner: 1, 'okazy-xxl': 1, 'legenda-lasu': 1 }, i);
    expect(merged['legenda-lasu']).toBe(1); // nagrodzone kiedyś – zostaje
    expect(merged.wedrowiec).toBe(3);
    expect(merged['seria-dni']).toBe(2);
    expect(newlyReached(merged, evaluateAchievements(i))).toEqual([]);
  });
});

describe('medale', () => {
  it('kolejność stopni zależy od ich liczby; 5 stopni kończy diament', () => {
    expect([1, 2, 3, 4, 5].map((t) => tierKind(5, t))).toEqual(MEDAL_ORDER);
    expect([1, 2, 3, 4].map((t) => tierKind(4, t))).toEqual(['braz', 'srebro', 'zloto', 'platyna']);
    expect([1, 2, 3].map((t) => tierKind(3, t))).toEqual(['braz', 'srebro', 'zloto']);
    expect([1, 2].map((t) => tierKind(2, t))).toEqual(['srebro', 'zloto']);
    expect(tierKind(1, 1)).toBe('zloto');
  });
});
