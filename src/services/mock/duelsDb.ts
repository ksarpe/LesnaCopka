/**
 * „Serwer” mocków pojedynków (docs/rywalizacja.md §3) i widoczności w rankingach – trwały stan w telefonie.
 * Stan pojedynków (przyjęcie przez bota, koniec, rozstrzygnięcie) liczy się z czasu przy odczycie
 * (src/services/mock/duels.ts → settle), bez timerów w tle. „Wyczyść dane” / reset panelu /dev czyści go
 * (mockServices.dev.reset).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage, STORAGE_KEYS } from '@/store/storage';
import type { DuelDays, DuelKind, DuelOutcome, DuelSide, DuelStatus } from '@/types';

export interface MockSideSnapshot {
  score: number;
  best: DuelSide['best'];
}

export interface MockDuelRecord {
  id: string;
  kind: DuelKind;
  days: DuelDays;
  /** Grzybiarz z puli mocków (PLAYERS) – druga strona pojedynku. */
  botId: string;
  iAmChallenger: boolean;
  status: DuelStatus;
  createdAt: string;
  /** Wyzwanie gracza: chwila, w której bot je przyjmie (symulacja z czasu). */
  acceptAt: string | null;
  startsAt: string | null;
  finishedAt: string | null;
  /** Wynik po rozstrzygnięciu (historia startowa ma go od razu). */
  result: { me: MockSideSnapshot; opponent: MockSideSnapshot; outcome: DuelOutcome; xp: number } | null;
}

type DuelsDbData = {
  /** Zestaw startowy (wyzwanie bota, trwający pojedynek, historia) już powstał – albo nowy gracz bez niego. */
  seeded: boolean;
  duels: MockDuelRecord[];
  /** Ustawienia → Prywatność: widoczność w rankingach grzybiarzy i na tablicach walk. */
  showInRankings: boolean;
  /** Chwile wysłania wyzwań przez gracza (limit na dobę). */
  sentAt: string[];
};

interface MockDuelsState extends DuelsDbData {
  set: (patch: Partial<DuelsDbData>) => void;
  /** `emptyFeed` (nowy gracz, wylogowanie) – bez zestawu startowego z botami. */
  reset: (opts?: { emptyFeed?: boolean }) => void;
}

const initial = (emptyFeed?: boolean): DuelsDbData => ({ seeded: !!emptyFeed, duels: [], showInRankings: true, sentAt: [] });

export const useMockDuelsDb = create<MockDuelsState>()(
  persist(
    (set) => ({
      ...initial(),
      set: (patch) => set(patch),
      reset: (opts) => set(initial(opts?.emptyFeed)),
    }),
    { name: STORAGE_KEYS.mockDuels, storage: persistStorage, version: 1 },
  ),
);

/** Czeka na odtworzenie stanu z AsyncStorage (pierwszy odczyt tuż po starcie nie zasieje pojedynków drugi raz). */
export function mockDuelsReady(): Promise<void> {
  const p = useMockDuelsDb.persist;
  if (p.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = p.onFinishHydration(() => {
      off();
      resolve();
    });
  });
}
