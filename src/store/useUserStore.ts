import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { SPECIES, START_ATLAS } from '@/data/mock/species';
import { START_BADGES, START_COUNTERS, START_USER, START_WEEKLY_CONTRIBUTION } from '@/data/mock/users';
import type { AchievementUnlock, AtlasEntry, GminaChallenge, QuestProgress, User } from '@/types';
import { seedAwarded } from '@/utils/achievements';
import { persistStorage, STORAGE_KEYS } from './storage';

export type Counters = typeof START_COUNTERS;

export interface AcceptedChallenge extends GminaChallenge {
  gminaId: string;
  acceptedAt: string;
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
  quests: { date: string; progress: Record<string, QuestProgress>; pendingRewards: string[] };
  challenges: AcceptedChallenge[];
  weeklyContribution: number;
  followedGminy: string[];
  /** Klucze „gmina:gatunek” znalezione dziś – bonus „pierwszy w gminie dziś”. */
  today: { date: string; keys: string[]; km: number };
  lastActiveDate: string;

  patch: (p: Partial<Omit<UserState, 'patch' | 'reset'>>) => void;
  reset: (state?: Partial<UserState>) => void;
}

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
  const counters = { ...START_COUNTERS };
  return {
    user: { ...START_USER },
    atlas,
    badges: [...START_BADGES],
    counters,
    // Gracz startowy ma już część stopni – liczą się jako nagrodzone (bez XP na wejściu).
    achievements: seedAwarded({ atlas, species: SPECIES, counters }),
    pendingAchievements: [],
    quests: { date: todayKey(now), progress: {}, pendingRewards: [] },
    challenges: [],
    weeklyContribution: START_WEEKLY_CONTRIBUTION,
    followedGminy: [],
    today: { date: todayKey(now), keys: [], km: 0 },
    lastActiveDate: todayKey(now),
  };
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
      version: 2,
      // v2: osiągnięcia. Zapisany gracz dostaje stopnie zdobyte do tej pory bez wypłaty XP.
      migrate: (persisted, version) => {
        const s = persisted as Omit<UserState, 'patch' | 'reset'>;
        if (version < 2) {
          const old = (s.counters ?? {}) as Partial<Counters>;
          const counters = { ...START_COUNTERS, ...old, xxlFinds: old.xxlFinds ?? 0 };
          return { ...s, counters, achievements: seedAwarded({ atlas: s.atlas ?? {}, species: SPECIES, counters }), pendingAchievements: [] };
        }
        return s;
      },
    },
  ),
);
