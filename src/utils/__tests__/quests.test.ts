import { describe, expect, it } from '@jest/globals';

import { DAILY_QUESTS, QUEST_POOL, seasonMonths } from '../../data/mock/game';
import { SPECIES } from '../../data/mock/species';
import type { Quest } from '../../types';
import {
  DESIGN_DAILY_QUEST_IDS,
  pickQuests,
  questDelta,
  questHash,
  questKindFromSql,
  questKindToSql,
  questPeriod,
  QUESTS_PER_PERIOD,
  selectQuests,
  weekStartKey,
  type QuestEvent,
} from '../quests';

const USERS = ['u-kuba', '7f9c1e2a-0b1d-4c55-9a77-3e2f1d0c9b8a', '00000000-0000-4000-8000-000000000001', 'user-1'];
const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
const byId = new Map(QUEST_POOL.map((q) => [q.id, q]));

describe('pula zadań', () => {
  it('unikalne id, zadania z makiety na początku, ok. 25+ szablonów dziennych i tygodniowych', () => {
    expect(new Set(QUEST_POOL.map((q) => q.id)).size).toBe(QUEST_POOL.length);
    expect(QUEST_POOL.slice(0, 3).map((q) => q.id)).toEqual([...DESIGN_DAILY_QUEST_IDS]);
    expect(DAILY_QUESTS.map((q) => q.id)).toEqual([...DESIGN_DAILY_QUEST_IDS]);
    expect(QUEST_POOL.length).toBeGreaterThanOrEqual(25);
    expect(QUEST_POOL.filter((q) => questPeriod(q) === 'weekly').length).toBeGreaterThanOrEqual(10);
    QUEST_POOL.forEach((q) => {
      expect(q.xp).toBeGreaterThan(0);
      expect(q.target).toBeGreaterThan(0);
      expect(q.kind).not.toBe('challenge');
      if (q.kind === 'species') expect(SPECIES.some((s) => s.id === q.speciesId)).toBe(true);
    });
    // Tygodniowe są większe niż dzienne.
    const maxDaily = Math.max(...QUEST_POOL.filter((q) => questPeriod(q) === 'daily').map((q) => q.xp));
    expect(Math.min(...QUEST_POOL.filter((q) => questPeriod(q) === 'weekly').map((q) => q.xp))).toBeGreaterThanOrEqual(maxDaily);
  });

  it('zadania „znajdź gatunek” tylko w sezonie (seasonWeights ≥ 0,5); gatunek bez sezonu – bez zadania', () => {
    expect(seasonMonths([0, 0, 0, 0.2, 0.5, 1, 0.9, 0.4, 0, 0, 0, 0])).toEqual([5, 6, 7]);
    expect(seasonMonths(undefined)).toEqual([]);
    QUEST_POOL.filter((q) => q.kind === 'species').forEach((q) => {
      const s = SPECIES.find((x) => x.id === q.speciesId)!;
      expect(q.months).toEqual(seasonMonths(s.seasonWeights));
      expect(q.months!.length).toBeGreaterThan(0);
    });
  });
});

describe('losowanie', () => {
  it('hash i tydzień – wartości wspólne z SQL (quest_hash, quests_for)', () => {
    expect(questHash('')).toBe(7);
    expect(questHash('abc')).toBe(304891);
    expect(weekStartKey('2026-10-07')).toBe('2026-10-05'); // środa → poniedziałek
    expect(weekStartKey('2026-10-05')).toBe('2026-10-05');
    expect(weekStartKey('2026-10-11')).toBe('2026-10-05'); // niedziela
    expect(weekStartKey('2027-01-01')).toBe('2026-12-28');
  });

  it('deterministyczne: ten sam gracz i dzień → te same zadania', () => {
    for (const u of USERS) {
      expect(selectQuests(QUEST_POOL, u, '2026-10-07')).toEqual(selectQuests(QUEST_POOL, u, '2026-10-07'));
    }
  });

  it('3 dzienne + 3 tygodniowe, bez powtórzeń rodzaju, dziennie co najmniej jedno łatwe, sezonowe tylko w sezonie', () => {
    for (const u of USERS) {
      for (const day of days('2026-01-01', 366)) {
        const sel = selectQuests(QUEST_POOL, u, day);
        const month = Number(day.slice(5, 7));
        expect(sel.daily).toHaveLength(QUESTS_PER_PERIOD);
        expect(sel.weekly).toHaveLength(QUESTS_PER_PERIOD);
        expect(new Set(sel.daily.map((q) => q.kind)).size).toBe(3);
        expect(new Set(sel.weekly.map((q) => q.kind)).size).toBe(3);
        expect(sel.daily.some((q) => (q.difficulty ?? 1) === 1)).toBe(true);
        sel.daily.forEach((q) => {
          expect(questPeriod(q)).toBe('daily');
          if (q.months) expect(q.months).toContain(month);
        });
        sel.weekly.forEach((q) => expect(questPeriod(q)).toBe('weekly'));
      }
    }
  });

  it('różnorodność: w ciągu miesiąca gracz widzi wiele różnych zadań, gracze różnią się między sobą', () => {
    const month = days('2026-10-01', 31);
    const seen = new Set(month.flatMap((d) => selectQuests(QUEST_POOL, 'u-kuba', d).daily.map((q) => q.id)));
    expect(seen.size).toBeGreaterThanOrEqual(12);
    const a = month.map((d) => selectQuests(QUEST_POOL, USERS[1], d).daily.map((q) => q.id).join());
    const b = month.map((d) => selectQuests(QUEST_POOL, USERS[2], d).daily.map((q) => q.id).join());
    expect(a.filter((x, i) => x !== b[i]).length).toBeGreaterThan(20);
    // Tygodniowe: te same przez cały tydzień, inne w następnym (zwykle).
    const week = days('2026-10-05', 7).map((d) => selectQuests(QUEST_POOL, 'u-kuba', d).weekly.map((q) => q.id).join());
    expect(new Set(week).size).toBe(1);
  });

  it('mała pula (np. 3 zadania z makiety) – wszystkie; pusta – nic', () => {
    expect(selectQuests(DAILY_QUESTS, 'u-kuba', '2026-10-07').daily.map((q) => q.id).sort()).toEqual([...DESIGN_DAILY_QUEST_IDS].sort());
    expect(selectQuests([], 'u-kuba', '2026-10-07')).toMatchObject({ daily: [], weekly: [] });
    expect(pickQuests(DAILY_QUESTS.filter((q) => q.difficulty !== 1), 's', 3, true)).toHaveLength(2);
  });
});

describe('postęp', () => {
  const q = (id: string) => byId.get(id) as Quest;
  const find = (p: Partial<Extract<QuestEvent, { type: 'find' }>> = {}): QuestEvent => ({
    type: 'find',
    rarity: 'pospolity',
    speciesId: 'podgrzybek-brunatny',
    xxl: false,
    collected: true,
    edible: true,
    poisonous: false,
    newInAtlas: false,
    away: false,
    firstOfSpeciesToday: false,
    firstOfSpeciesThisWeek: false,
    ...p,
  });

  it('znaleziska: skan, rzadkość, gatunek, nowy w atlasie, trujący, poza domem, XXL, jadalne, różne gatunki', () => {
    expect(questDelta(q('q-scan-5'), find())).toBe(1);
    expect(questDelta(q('q-rare-1'), find())).toBe(0);
    expect(questDelta(q('q-rare-1'), find({ rarity: 'epicki' }))).toBe(1);
    expect(questDelta(q('d-epic-1'), find({ rarity: 'rzadki' }))).toBe(0);
    expect(questDelta(q('d-epic-1'), find({ rarity: 'legendarny' }))).toBe(1);
    expect(questDelta(q('d-new-species'), find({ newInAtlas: true }))).toBe(1);
    expect(questDelta(q('d-poison-photo'), find({ poisonous: true, collected: false }))).toBe(1);
    expect(questDelta(q('d-away'), find({ away: true }))).toBe(1);
    expect(questDelta(q('d-xxl-1'), find({ xxl: true, collected: false }))).toBe(0);
    expect(questDelta(q('d-xxl-1'), find({ xxl: true }))).toBe(1);
    expect(questDelta(q('d-edible-5'), find({ edible: true, collected: false }))).toBe(0);
    expect(questDelta(q('d-variety-3'), find({ firstOfSpeciesToday: true }))).toBe(1);
    expect(questDelta(q('w-variety-10'), find({ firstOfSpeciesToday: true }))).toBe(0);
    expect(questDelta(q('w-variety-10'), find({ firstOfSpeciesThisWeek: true }))).toBe(1);
    expect(questDelta(q('q-km-5'), find())).toBe(0);
    const sp = QUEST_POOL.find((x) => x.kind === 'species')!;
    expect(questDelta(sp, find({ speciesId: sp.speciesId! }))).toBe(1);
    expect(questDelta(sp, find({ speciesId: 'nie-ma' }))).toBe(0);
  });

  it('wyprawy i społeczność', () => {
    expect(questDelta(q('d-early-7'), { type: 'tripStart', hour: 6 })).toBe(1);
    expect(questDelta(q('d-early-7'), { type: 'tripStart', hour: 7 })).toBe(0);
    expect(questDelta(q('d-trip-60'), { type: 'tripFinish', minutes: 59 })).toBe(0);
    expect(questDelta(q('d-trip-60'), { type: 'tripFinish', minutes: 60 })).toBe(1);
    expect(questDelta(q('w-trip-120'), { type: 'tripFinish', minutes: 90 })).toBe(0);
    expect(questDelta(q('w-trips-3'), { type: 'tripFinish', minutes: 5 })).toBe(1);
    expect(questDelta(q('d-publish'), { type: 'publish' })).toBe(1);
    expect(questDelta(q('d-react-3'), { type: 'reaction' })).toBe(1);
    expect(questDelta(q('d-react-3'), { type: 'publish' })).toBe(0);
  });

  it('rodzaje w bazie (snake_case) w obie strony', () => {
    expect(questKindToSql('tripMinutes')).toBe('trip_minutes');
    expect(questKindToSql('scans')).toBe('scans');
    expect(questKindFromSql('poison_photo')).toBe('poisonPhoto');
    expect(questKindFromSql('challenge')).toBeNull();
    expect(questKindFromSql('cos_nowego')).toBeNull();
    QUEST_POOL.forEach((x) => expect(questKindFromSql(questKindToSql(x.kind))).toBe(x.kind));
  });
});
