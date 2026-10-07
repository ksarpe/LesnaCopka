import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { QUEST_POOL } from '@/data/mock/game';
import { SPECIES, START_ATLAS } from '@/data/mock/species';
import { START_BADGES, START_COUNTERS, START_USER, START_WEEKLY_CONTRIBUTION } from '@/data/mock/users';
import type { AchievementUnlock, AtlasEntry, GminaChallenge, QuestProgress, User } from '@/types';
import { mergeSeedAwarded, seedAwarded } from '@/utils/achievements';
import { normalizeCounters, type PlayerCounters } from '@/utils/counters';
import { selectQuests } from '@/utils/quests';
import { persistStorage, STORAGE_KEYS } from './storage';

export type Counters = PlayerCounters;

/** Zadania dnia: postęp resetuje się, gdy zmieni się data. */
export interface DailyQuestsState {
  date: string;
  progress: Record<string, QuestProgress>;
  /** Ukończone zadania (dzienne, tygodniowe, wyzwania) czekające na wypłatę XP (po ekranie Nagroda). */
  pendingRewards: string[];
  /** Zadania wylosowane na `date` (src/utils/quests.ts; tryb Supabase – z serwera). Brak = losowanie przy odczycie. */
  ids?: string[];
  /** Scenariusz dev-linku: zadania z makiety przypięte na ten dzień (synchronizacja ich nie podmienia). */
  pinned?: boolean;
}

/** Zadania tygodnia (od poniedziałku): wylosowane id, postęp i kilometry tygodnia (zadanie dystansu). */
export interface WeeklyQuestsState {
  /** Poniedziałek tygodnia (YYYY-MM-DD). */
  week: string;
  ids: string[];
  progress: Record<string, QuestProgress>;
  km: number;
}

/** Puste zadania dnia i tygodnia z losowaniem dla gracza `userId` (pula z mocków = seed bazy). */
export function questsFor(userId: string, day: string): { quests: DailyQuestsState; weeklyQuests: WeeklyQuestsState } {
  const sel = selectQuests(QUEST_POOL, userId, day);
  return {
    quests: { date: day, progress: {}, pendingRewards: [], ids: sel.daily.map((q) => q.id) },
    weeklyQuests: { week: sel.week, ids: sel.weekly.map((q) => q.id), progress: {}, km: 0 },
  };
}

export interface AcceptedChallenge extends GminaChallenge {
  gminaId: string;
  acceptedAt: string;
  /** Ukończone (tryb Supabase – z serwera): zadanie „zrobione” tylko w dniu ukończenia, potem znika. */
  completedAt?: string;
}

export interface UserState {
  user: User;
  atlas: Record<string, AtlasEntry>;
  badges: string[];
  counters: Counters;
  /** Osiągnięcia: liczba nagrodzonych stopni per id (postęp liczy się na bieżąco z atlasu). */
  achievements: Record<string, number>;
  /** Stopnie zdobyte przy znalezisku – XP wypłacane po ekranie Nagroda (jak zadania dnia). */
  pendingAchievements: AchievementUnlock[];
  /** Zadania dnia: postęp resetuje się, gdy zmieni się data. */
  quests: DailyQuestsState;
  /** Zadania tygodnia: reset w poniedziałek. */
  weeklyQuests: WeeklyQuestsState;
  challenges: AcceptedChallenge[];
  weeklyContribution: number;
  followedGminy: string[];
  /** Klucze „gmina:gatunek” znalezione dziś – bonus „pierwszy w gminie dziś”. */
  today: { date: string; keys: string[]; km: number };
  lastActiveDate: string;
  /**
   * Pierwsza konfiguracja (app/onboarding.tsx) za gracza: false → zamiast zakładek ekran powitalny (app/_layout.tsx).
   * Gracz demo z mocków i zapisani gracze sprzed onboardingu – true; tryb Supabase: z serwera (`onboardedAt`).
   */
  onboarded: boolean;
  /** Zaakceptowana wersja regulaminu i polityki prywatności (LEGAL_VERSION) i kiedy – lokalnie i z serwera. */
  terms?: { version: string; acceptedAt: string };

  patch: (p: Partial<Omit<UserState, 'patch' | 'reset'>>) => void;
  reset: (state?: Partial<UserState>) => void;
}

let serverPatch = false;

/**
 * Zmiana stanu przyjęta z serwera (tryb Supabase: stan gry, obserwowane gminy z ekranu gminy) – nie akcja gracza.
 * Subskrybenci (NotificationsHost) nie witają wtedy „Obserwujesz gminę…” (np. po reinstalacji albo z innego telefonu).
 */
export function patchFromServer(p: Parameters<UserState['patch']>[0]) {
  serverPatch = true;
  try {
    useUserStore.getState().patch(p);
  } finally {
    serverPatch = false;
  }
}

/** Czy trwa zmiana z serwera (sprawdzane synchronicznie w subskrypcji store'u). */
export const isServerPatch = () => serverPatch;

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initialUserState(): Omit<UserState, 'patch' | 'reset'> {
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
  const atlas: Record<string, AtlasEntry> = {};
  Object.entries(START_ATLAS).forEach(([id, count], i) => {
    atlas[id] = { count, firstFoundAt: ago(400 - i * 9), bestCapCm: 0, bestWeightG: 0 };
  });
  // Rekordy osobiste do porównań „rekord osobisty”.
  atlas['borowik-szlachetny'] = { ...atlas['borowik-szlachetny'], bestCapCm: 16, bestWeightG: 520 };
  atlas['czubajka-kania'] = { ...atlas['czubajka-kania'], bestCapCm: 27, bestWeightG: 240 };
  const counters: PlayerCounters = { ...START_COUNTERS };
  return {
    user: { ...START_USER },
    atlas,
    badges: [...START_BADGES],
    counters,
    // Gracz startowy ma już część stopni – liczą się jako nagrodzone (bez XP na wejściu).
    achievements: seedAwarded({ atlas, species: SPECIES, counters }),
    pendingAchievements: [],
    ...questsFor(START_USER.id, todayKey(now)),
    challenges: [],
    weeklyContribution: START_WEEKLY_CONTRIBUTION,
    followedGminy: [],
    today: { date: todayKey(now), keys: [], km: 0 },
    lastActiveDate: todayKey(now),
    onboarded: true,
  };
}

let freshInstallOnboarded = true;

/**
 * Wartość `onboarded` dla pierwszego uruchomienia (nic zapisanego w pamięci telefonu). Tryb mock: true – gracz demo
 * z makiety od razu; tryb Supabase (createSupabaseServices): false – nowy gracz zaczyna od onboardingu, zanim pierwsza
 * synchronizacja przyjmie stan konta z serwera. Ustawiane przed odczytem zapisu z AsyncStorage.
 */
export function setFreshInstallOnboarded(value: boolean) {
  freshInstallOnboarded = value;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...initialUserState(),
      patch: (p) => set(p),
      reset: (state) => set({ ...initialUserState(), ...state }),
    }),
    {
      name: STORAGE_KEYS.user,
      storage: persistStorage,
      version: 5,
      // v2: osiągnięcia. Zapisany gracz dostaje stopnie zdobyte do tej pory bez wypłaty XP.
      // v3: edycja profilu – `user.avatar` i `user.bio` są opcjonalne, więc bez przekształceń.
      // v4: onboarding – gracz, który już grał, nie przechodzi go od nowa.
      // v5: progresja – liczniki osiągnięć, diamenty, zadania rotacyjne dzienne i tygodniowe.
      migrate: (persisted, version) => {
        let s = persisted as Omit<UserState, 'patch' | 'reset'>;
        if (version < 2) {
          const old = (s.counters ?? {}) as Partial<Counters>;
          const counters = { ...START_COUNTERS, ...old, xxlFinds: old.xxlFinds ?? 0 };
          s = { ...s, counters, achievements: seedAwarded({ atlas: s.atlas ?? {}, species: SPECIES, counters }), pendingAchievements: [] };
        }
        if (version < 4) s = { ...s, onboarded: true };
        if (version < 5) {
          // v5: progresja – nowe liczniki (z tego, co da się odtworzyć ze stanu gracza; reszta od zera), zadania
          // rotacyjne z tygodniowymi; osiągnięte już stopnie nowych osiągnięć – nagrodzone bez XP (jak seed_achievements).
          const old = (s.counters ?? {}) as Partial<PlayerCounters>;
          const badges = s.badges ?? [];
          const counters = normalizeCounters({
            ...old,
            trips: old.trips ?? s.user?.tripsCount ?? 0,
            maxStreak: Math.max(old.maxStreak ?? 0, s.user?.streakDays ?? 0, badges.includes('seria-7') ? 7 : 0),
            earlyTrips: old.earlyTrips ?? (badges.includes('ranny-ptaszek') ? 1 : 0),
          });
          const fresh = questsFor(s.user?.id ?? START_USER.id, todayKey());
          s = {
            ...s,
            counters,
            achievements: mergeSeedAwarded(s.achievements ?? {}, { atlas: s.atlas ?? {}, species: SPECIES, counters }),
            quests: s.quests?.date === fresh.quests.date ? { ...fresh.quests, ...s.quests, ids: fresh.quests.ids } : fresh.quests,
            weeklyQuests: fresh.weeklyQuests,
          };
        }
        return s;
      },
      // Pierwsze uruchomienie (brak zapisu): `onboarded` zależnie od trybu – setFreshInstallOnboarded.
      merge: (persisted, current) =>
        persisted ? { ...current, ...(persisted as Partial<UserState>) } : { ...current, onboarded: freshInstallOnboarded },
    },
  ),
);
