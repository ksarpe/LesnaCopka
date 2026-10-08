/**
 * Liczniki postępu gracza – źródło odznak, osiągnięć (metryka `counter`) i części zadań. Czyste funkcje aktualizacji.
 *
 * Tryb mock: liczone w telefonie (src/store/game.ts). Tryb Supabase: po synchronizacji wartości z serwera
 * (`get_game_state().counters` = `player_metrics()` w SQL – klucze snake_case, patrz `countersFromServer`);
 * telefon dolicza zdarzenia lokalnie do czasu następnej synchronizacji. Czas lokalny telefonu ≈ Europe/Warsaw serwera.
 * Testy: src/utils/__tests__/counters.test.ts.
 */
import type { Find, Gmina, Rarity } from '@/types';

export interface PlayerCounters {
  /* Odznaki */
  /** Zebrane borowiki szlachetne z gmin Puszczy Knyszyńskiej (odznaka „Król Puszczy”). */
  borowikiKnyszynska: number;
  totalKm: number;
  /** Bieżąca seria dni. */
  streakDays: number;
  legendaryFinds: number;
  /** Zebrane okazy XXL. */
  xxlFinds: number;

  /* Okazy (odebrane znaleziska, także zdjęcia) */
  epicFinds: number;
  /** Rzadkie i lepsze. */
  rareFinds: number;
  /** Zdjęcia gatunków trujących i śmiertelnie trujących. */
  poisonPhotos: number;

  /* Wyprawy */
  /** Zakończone wyprawy. */
  trips: number;
  /** Najdłuższa wyprawa (km) i najdłuższy czas wyprawy (min). */
  maxTripKm: number;
  maxTripMin: number;
  /** Wyprawy rozpoczęte przed 6:00. */
  earlyTrips: number;
  /** Najwięcej odebranych znalezisk na jednej wyprawie. */
  maxTripFinds: number;

  /* Odkrywca: listy bez powtórzeń (wartość metryki = długość) */
  gminy: string[];
  voivodeships: string[];
  /** Kompleksy leśne (Gmina.forest, np. „Puszcza Knyszyńska”). */
  forests: string[];
  /** Znaleziska poza gminą domową. */
  awayFinds: number;

  /* Pory roku */
  /** Miesiące (1–12) ze znaleziskiem. */
  months: number[];
  springFinds: number;
  summerFinds: number;
  autumnFinds: number;
  winterFinds: number;

  /* Seria */
  maxStreak: number;
  /** Dni z wyprawą. */
  activeDays: number;

  /* Społeczność */
  reactionsGiven: number;
  reactionsReceived: number;
  comments: number;
  friends: number;
  /** Opublikowane wyprawy. */
  published: number;

  /* Wyzwania */
  challengesDone: number;
  dailyQuestsDone: number;
  weeklyQuestsDone: number;

  /* Sekretne */
  /** Najdłuższa seria znalezisk tego samego gatunku z rzędu. */
  sameSpeciesRun: number;
  /** Znaleziska o 11:11. */
  findsAt1111: number;
  /** Zdjęcia trujących w piątek 13. (łącznie). */
  friday13Poison: number;
  /** Znaleziska między 22:00 a 4:00. */
  nightFinds: number;
  /** Znaleziska w Wigilię (24 grudnia). */
  christmasFinds: number;

  /* Tylko w telefonie (bieżąca seria gatunku – do `sameSpeciesRun`) */
  runSpeciesId: string;
  runLength: number;
}

export const EMPTY_COUNTERS: PlayerCounters = {
  borowikiKnyszynska: 0,
  totalKm: 0,
  streakDays: 0,
  legendaryFinds: 0,
  xxlFinds: 0,
  epicFinds: 0,
  rareFinds: 0,
  poisonPhotos: 0,
  trips: 0,
  maxTripKm: 0,
  maxTripMin: 0,
  earlyTrips: 0,
  maxTripFinds: 0,
  gminy: [],
  voivodeships: [],
  forests: [],
  awayFinds: 0,
  months: [],
  springFinds: 0,
  summerFinds: 0,
  autumnFinds: 0,
  winterFinds: 0,
  maxStreak: 0,
  activeDays: 0,
  reactionsGiven: 0,
  reactionsReceived: 0,
  comments: 0,
  friends: 0,
  published: 0,
  challengesDone: 0,
  dailyQuestsDone: 0,
  weeklyQuestsDone: 0,
  sameSpeciesRun: 0,
  findsAt1111: 0,
  friday13Poison: 0,
  nightFinds: 0,
  christmasFinds: 0,
  runSpeciesId: '',
  runLength: 0,
};

/** Liczniki-listy: wartość metryki = liczba elementów. */
export const LIST_COUNTERS = ['gminy', 'voivodeships', 'forests', 'months'] as const;
export type ListCounterKey = (typeof LIST_COUNTERS)[number];
type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
/** Liczniki, które mogą być metryką osiągnięcia (bez pól tylko-w-telefonie). */
export type CounterKey = Exclude<NumericKeys<PlayerCounters>, 'runLength'> | ListCounterKey;

/** Wartość licznika (lista → długość; brak – np. stary zapis – → 0). */
export function counterValue(c: Partial<PlayerCounters> | undefined, key: CounterKey): number {
  const v = c?.[key] as unknown;
  if (Array.isArray(v)) return v.length;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Uzupełnia brakujące pola (zapis sprzed wersji, odpowiedź serwera) wartościami startowymi. */
export function normalizeCounters(raw: Partial<PlayerCounters> | undefined | null): PlayerCounters {
  const out = { ...EMPTY_COUNTERS } as Record<string, unknown>;
  for (const [k, def] of Object.entries(EMPTY_COUNTERS)) {
    const v = (raw as Record<string, unknown> | undefined)?.[k];
    if (Array.isArray(def)) out[k] = Array.isArray(v) ? [...v] : [];
    else if (typeof def === 'number') out[k] = typeof v === 'number' && Number.isFinite(v) ? v : def;
    else out[k] = typeof v === 'string' ? v : def;
  }
  return out as unknown as PlayerCounters;
}

/**
 * `get_game_state().counters` (klucze jak w enumie `achievement_metric`: `total_km`, `finds_at_1111`) → liczniki
 * aplikacji. Pola, których serwer nie zwraca (bieżąca seria gatunku), zostają z `local`.
 */
export function countersFromServer(raw: Record<string, unknown>, local: Partial<PlayerCounters>): PlayerCounters {
  const camel: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) camel[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  const base = normalizeCounters(local);
  const out = { ...base } as unknown as Record<string, unknown>;
  for (const [k, def] of Object.entries(EMPTY_COUNTERS)) {
    if (!(k in camel)) continue;
    const v = camel[k];
    if (Array.isArray(def)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string' || typeof x === 'number');
    } else if (typeof def === 'number') {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out as unknown as PlayerCounters;
}

/* ───────────────────────── Pory roku ───────────────────────── */

export type Season = 'wiosna' | 'lato' | 'jesien' | 'zima';

/** Miesiąc 1–12 → pora roku (meteorologiczna: wiosna III–V, lato VI–VIII, jesień IX–XI, zima XII–II). */
export function seasonOfMonth(month: number): Season {
  if (month >= 3 && month <= 5) return 'wiosna';
  if (month >= 6 && month <= 8) return 'lato';
  if (month >= 9 && month <= 11) return 'jesien';
  return 'zima';
}

/** Ile pór roku obejmują miesiące ze znaleziskami (0–4). */
export function seasonsCovered(months: readonly number[]): number {
  return new Set(months.map(seasonOfMonth)).size;
}

const SEASON_FIELD: Record<Season, 'springFinds' | 'summerFinds' | 'autumnFinds' | 'winterFinds'> = {
  wiosna: 'springFinds',
  lato: 'summerFinds',
  jesien: 'autumnFinds',
  zima: 'winterFinds',
};

const addUnique = <T>(list: T[], v: T | undefined | null): T[] => (v == null || v === '' || list.includes(v) ? list : [...list, v]);

/* ───────────────────────── Zdarzenia ───────────────────────── */

const RANK: Record<Rarity, number> = { pospolity: 0, rzadki: 1, epicki: 2, legendarny: 3 };

export interface FindCountInput {
  find: Pick<Find, 'speciesId' | 'gminaId' | 'rarity' | 'xxl' | 'collected' | 'foundAt'>;
  /** Gatunek trujący / śmiertelnie trujący (zdjęcie). */
  poisonous: boolean;
  gmina?: Pick<Gmina, 'voivodeship' | 'forest'>;
  homeGminaId?: string;
  /** Odebrane znaleziska wyprawy łącznie z tym. */
  tripFinds: number;
}

/** Odebrane znalezisko (claimFind): okazy, odkrywca, pory roku, sekretne, odznaki. */
export function countFind(c: PlayerCounters, x: FindCountInput): PlayerCounters {
  const { find } = x;
  const at = new Date(find.foundAt);
  const month = at.getMonth() + 1;
  const hour = at.getHours();
  const out: PlayerCounters = { ...c };
  if (find.collected && find.speciesId === 'borowik-szlachetny' && x.gmina?.forest === 'Puszcza Knyszyńska') out.borowikiKnyszynska += 1;
  if (find.rarity === 'legendarny') out.legendaryFinds += 1;
  if (RANK[find.rarity] >= RANK.epicki) out.epicFinds += 1;
  if (RANK[find.rarity] >= RANK.rzadki) out.rareFinds += 1;
  if (find.xxl && find.collected) out.xxlFinds += 1;
  if (x.poisonous) out.poisonPhotos += 1;
  out.maxTripFinds = Math.max(out.maxTripFinds, x.tripFinds);

  out.gminy = addUnique(out.gminy, find.gminaId);
  out.voivodeships = addUnique(out.voivodeships, x.gmina?.voivodeship);
  out.forests = addUnique(out.forests, x.gmina?.forest);
  if (x.homeGminaId && find.gminaId !== x.homeGminaId) out.awayFinds += 1;

  if (Number.isFinite(month)) {
    out.months = addUnique(out.months, month).sort((a, b) => a - b);
    out[SEASON_FIELD[seasonOfMonth(month)]] += 1;
  }

  const sameRun = out.runSpeciesId === find.speciesId;
  out.runSpeciesId = find.speciesId;
  out.runLength = sameRun ? out.runLength + 1 : 1;
  out.sameSpeciesRun = Math.max(out.sameSpeciesRun, out.runLength);
  if (hour === 11 && at.getMinutes() === 11) out.findsAt1111 += 1;
  if (x.poisonous && at.getDay() === 5 && at.getDate() === 13) out.friday13Poison += 1;
  if (hour >= 22 || hour < 4) out.nightFinds += 1;
  if (month === 12 && at.getDate() === 24) out.christmasFinds += 1;
  return out;
}

/** Godzina, przed którą start wyprawy liczy się jako „ranny ptaszek” (odznaka i osiągnięcie „Skowronek”). */
export const EARLY_TRIP_HOUR = 6;

/** Start wyprawy (czas lokalny). */
export function countTripStart(c: PlayerCounters, startedAt: Date): PlayerCounters {
  return startedAt.getHours() < EARLY_TRIP_HOUR ? { ...c, earlyTrips: c.earlyTrips + 1 } : c;
}

/** Koniec wyprawy: liczba wypraw, rekordy dystansu i czasu. */
export function countTripFinish(c: PlayerCounters, trip: { distanceKm: number; minutes: number }): PlayerCounters {
  return {
    ...c,
    trips: c.trips + 1,
    maxTripKm: Math.max(c.maxTripKm, Math.round(trip.distanceKm * 10) / 10),
    maxTripMin: Math.max(c.maxTripMin, Math.floor(trip.minutes)),
  };
}

/**
 * Seria dni do pokazania: przerwana (0), gdy ostatnia aktywność była przed wczoraj – ta sama reguła co
 * `bumpStreakForToday` (src/store/game.ts) i przyjęcie stanu z serwera (src/services/supabase/gameState.ts).
 */
export function effectiveStreak(streakDays: number, lastActiveDate: string | null, today: string, yesterday: string): number {
  if (!lastActiveDate) return 0;
  return lastActiveDate === today || lastActiveDate === yesterday ? streakDays : 0;
}

/** Nowy dzień aktywności (pierwsza wyprawa dnia): seria, najdłuższa seria, dni w lesie. */
export function countActiveDay(c: PlayerCounters, streak: number): PlayerCounters {
  return { ...c, streakDays: streak, maxStreak: Math.max(c.maxStreak, streak), activeDays: c.activeDays + 1 };
}

export type SocialEvent = 'reactionGiven' | 'reactionRemoved' | 'comment' | 'friend' | 'friendRemoved' | 'published';

/** Społeczność: reakcja (i jej cofnięcie), komentarz, nowy znajomy, publikacja wyprawy. */
export function countSocial(c: PlayerCounters, e: SocialEvent): PlayerCounters {
  switch (e) {
    case 'reactionGiven':
      return { ...c, reactionsGiven: c.reactionsGiven + 1 };
    case 'reactionRemoved':
      return { ...c, reactionsGiven: Math.max(0, c.reactionsGiven - 1) };
    case 'comment':
      return { ...c, comments: c.comments + 1 };
    case 'friend':
      return { ...c, friends: c.friends + 1 };
    case 'friendRemoved':
      return { ...c, friends: Math.max(0, c.friends - 1) };
    case 'published':
      return { ...c, published: c.published + 1 };
  }
}

/**
 * Klucz licznika w SQL (wartość enumu `achievement_metric` i klucz `player_metrics()`): snake_case, liczby jako
 * osobny człon – `totalKm` → `total_km`, `findsAt1111` → `finds_at_1111`, `friday13Poison` → `friday_13_poison`.
 */
export function counterSqlKey(key: CounterKey): string {
  return key.replace(/([a-z])([0-9])/g, '$1_$2').replace(/([0-9])([A-Za-z])/g, '$1_$2').replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/__/g, '_');
}
