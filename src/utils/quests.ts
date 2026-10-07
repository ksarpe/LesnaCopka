/**
 * Zadania rotacyjne – czyste funkcje (testy: src/utils/__tests__/quests.test.ts).
 *
 * Pula szablonów (src/data/mock/game.ts → `quest_templates` w seedzie) dzieli się na dzienne i tygodniowe.
 * Każdy gracz dostaje 3 dzienne (nowe o północy) i 3 tygodniowe (nowe w poniedziałek), wylosowane
 * DETERMINISTYCZNIE z (id gracza, dzień / poniedziałek tygodnia): ten sam gracz w ten sam dzień widzi te same zadania
 * na każdym telefonie, a serwer (`quests_for(user, day)` w 20261013110000_progression.sql) losuje identycznie –
 * ten sam hash, ten sam generator i ta sama kolejność puli (`sort`). Zasady: bez dwóch zadań tego samego rodzaju,
 * dziennie zawsze co najmniej jedno łatwe (difficulty 1), zadania „znajdź gatunek” tylko w jego sezonie (`months`).
 */
import type { Quest, QuestKind, QuestPeriod, Rarity } from '@/types';

export const QUESTS_PER_PERIOD = 3;

/** Zadania dnia z makiety (Zeskanuj 5 · Znajdź rzadki · Przejdź 5 km) – scenariusze dev-linków je przypinają. */
export const DESIGN_DAILY_QUEST_IDS = ['q-scan-5', 'q-rare-1', 'q-km-5'] as const;

export const questPeriod = (q: Pick<Quest, 'period'>): QuestPeriod => q.period ?? 'daily';

/* ───────────────────────── Losowanie (lustro SQL) ───────────────────────── */

const MOD = 2147483647; // 2^31 − 1

/** Hash tekstu: h = (h · 31 + kod znaku) mod (2^31 − 1), start 7. Tylko ASCII (uuid, daty) – jak `quest_hash` w SQL. */
export function questHash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % MOD;
  return h;
}

/** Generator Parka–Millera (MINSTD): x · 48271 mod (2^31 − 1). Iloczyn < 2^53 – dokładny w double. */
const nextRand = (x: number) => (x * 48271) % MOD;

/**
 * Wybiera `count` zadań z `pool` (kolejność puli ma znaczenie): najpierw – gdy `requireEasy` – jedno łatwe,
 * potem kolejne o rodzaju jeszcze niewybranym. Indeks = kolejna liczba generatora mod liczba kandydatów.
 */
export function pickQuests(pool: readonly Quest[], seed: string, count: number, requireEasy: boolean): Quest[] {
  let s = (questHash(seed) % (MOD - 1)) + 1;
  const picked: Quest[] = [];
  const kinds = new Set<QuestKind>();
  const take = (cands: Quest[]) => {
    s = nextRand(s);
    const q = cands[s % cands.length];
    picked.push(q);
    kinds.add(q.kind);
  };
  if (requireEasy) {
    const easy = pool.filter((q) => (q.difficulty ?? 1) === 1);
    if (easy.length) take(easy);
  }
  while (picked.length < count) {
    const cands = pool.filter((q) => !kinds.has(q.kind) && !picked.includes(q));
    if (!cands.length) break;
    take(cands);
  }
  return picked;
}

/** „2026-10-07” → poniedziałek tego tygodnia („2026-10-05”). Bez stref czasowych (data kalendarzowa). */
export function weekStartKey(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // pon = 0
  const monday = new Date(t - dow * 86400000);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
}

const inSeason = (q: Quest, month: number) => !q.months?.length || q.months.includes(month);

export interface QuestSelection {
  day: string;
  week: string;
  daily: Quest[];
  weekly: Quest[];
}

/** Zadania gracza na dzień `day` (YYYY-MM-DD, czas lokalny) i jego tydzień. */
export function selectQuests(pool: readonly Quest[], userId: string, day: string): QuestSelection {
  const month = Number(day.slice(5, 7));
  const week = weekStartKey(day);
  const daily = pool.filter((q) => q.kind !== 'challenge' && questPeriod(q) === 'daily' && inSeason(q, month));
  const weekly = pool.filter((q) => q.kind !== 'challenge' && questPeriod(q) === 'weekly' && inSeason(q, month));
  return {
    day,
    week,
    daily: pickQuests(daily, `${userId}|${day}|d`, QUESTS_PER_PERIOD, true),
    weekly: pickQuests(weekly, `${userId}|${week}|w`, QUESTS_PER_PERIOD, false),
  };
}

/* ───────────────────────── Postęp ───────────────────────── */

const RANK: Record<Rarity, number> = { pospolity: 0, rzadki: 1, epicki: 2, legendarny: 3 };

/** Zdarzenie gry, które może posunąć zadanie (dystans – osobno, bo liczy się narastająco). */
export type QuestEvent =
  | {
      type: 'find';
      rarity: Rarity;
      speciesId: string;
      xxl: boolean;
      collected: boolean;
      edible: boolean;
      poisonous: boolean;
      newInAtlas: boolean;
      /** Poza gminą domową. */
      away: boolean;
      /** Pierwszy okaz tego gatunku dziś / w tym tygodniu („różne gatunki”). */
      firstOfSpeciesToday: boolean;
      firstOfSpeciesThisWeek: boolean;
    }
  | { type: 'tripStart'; hour: number }
  | { type: 'tripFinish'; minutes: number }
  | { type: 'publish' }
  | { type: 'reaction' };

/** Domyślna godzina zadania „Wyrusz przed 7:00”. */
export const EARLY_START_HOUR = 7;

/** O ile zdarzenie posuwa zadanie (0 = wcale). Wyzwania gmin i dystans liczy src/store/game.ts. */
export function questDelta(q: Quest, e: QuestEvent): number {
  switch (e.type) {
    case 'find': {
      const hit = (() => {
        switch (q.kind) {
          case 'scans':
            return true;
          case 'rare':
            return RANK[e.rarity] >= RANK.rzadki;
          case 'epic':
            return RANK[e.rarity] >= RANK.epicki;
          case 'species':
            return !!q.speciesId && q.speciesId === e.speciesId;
          case 'newSpecies':
            return e.newInAtlas;
          case 'poisonPhoto':
            return e.poisonous;
          case 'awayGmina':
            return e.away;
          case 'xxl':
            return e.xxl && e.collected;
          case 'edible':
            return e.edible && e.collected;
          case 'variety':
            return questPeriod(q) === 'weekly' ? e.firstOfSpeciesThisWeek : e.firstOfSpeciesToday;
          default:
            return false;
        }
      })();
      return hit ? 1 : 0;
    }
    case 'tripStart':
      return q.kind === 'earlyStart' && e.hour < (q.beforeHour ?? EARLY_START_HOUR) ? 1 : 0;
    case 'tripFinish':
      if (q.kind === 'trips') return 1;
      return q.kind === 'tripMinutes' && e.minutes >= (q.minutes ?? 60) ? 1 : 0;
    case 'publish':
      return q.kind === 'publish' ? 1 : 0;
    case 'reaction':
      return q.kind === 'reactions' ? 1 : 0;
  }
}

/* ───────────────────────── Serwer ───────────────────────── */

/** Rodzaj zadania w bazie (`quest_kind`): snake_case (`tripMinutes` → `trip_minutes`). */
export function questKindToSql(k: QuestKind): string {
  return k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const KINDS: QuestKind[] = [
  'scans',
  'rare',
  'epic',
  'distance',
  'species',
  'tripMinutes',
  'newSpecies',
  'poisonPhoto',
  'awayGmina',
  'xxl',
  'edible',
  'variety',
  'publish',
  'reactions',
  'earlyStart',
  'trips',
];

/** `quest_kind` z bazy → rodzaj w aplikacji; nieznany (nowszy serwer) → null (zadanie pomijamy). */
export function questKindFromSql(k: string): QuestKind | null {
  return KINDS.find((x) => questKindToSql(x) === k) ?? null;
}
