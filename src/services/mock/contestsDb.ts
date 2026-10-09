/**
 * „Serwer” mocków walk o okaz – trwałe zgłoszenia gracza (okazy w walkach tygodni) i zgłoszenia cudzych okazów.
 * Boty i ich okazy nie są zapisywane: generuje je deterministycznie ./contests.ts. Reset razem z „bazą” mocków
 * (Services.dev.reset – „Wyczyść dane”, panel /dev, zmiana konta).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage, STORAGE_KEYS } from '@/store/storage';

/** Okaz gracza zgłoszony do walki – kopia danych znaleziska z chwili zgłoszenia (zdjęcie – z telefonu, po findId). */
export interface StoredContestEntry {
  contestId: string;
  entryId: string;
  findId: string;
  speciesId: string;
  capCm: number;
  gminaId: string;
  voivodeship: string;
  foundAt: string;
  enteredAt: string;
}

type ContestsData = {
  entries: StoredContestEntry[];
  /** Okazy zgłoszone przez gracza do moderacji (id wpisów tablicy). */
  reported: string[];
  /**
   * Gracz demo z makiety: historia walk z poprzednich tygodni (trofea, okaz na tablicy minionego tygodnia).
   * Nowy gracz („Nowy użytkownik”, nowe konto) – bez historii.
   */
  demo: boolean;
};

interface ContestsDbState extends ContestsData {
  set: (patch: Partial<ContestsData>) => void;
  reset: (opts?: { emptyFeed?: boolean }) => void;
}

const initial = (emptyFeed?: boolean): ContestsData => ({ entries: [], reported: [], demo: !emptyFeed });

export const useContestsDb = create<ContestsDbState>()(
  persist(
    (set) => ({
      ...initial(),
      set: (patch) => set(patch),
      reset: (opts) => set(initial(opts?.emptyFeed)),
    }),
    { name: STORAGE_KEYS.mockContests, storage: persistStorage, version: 1 },
  ),
);

/** Czeka na odtworzenie zgłoszeń z AsyncStorage (pierwsze wywołanie serwisu tuż po starcie). */
export function contestsDbReady(): Promise<void> {
  const p = useContestsDb.persist;
  if (!p || p.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = p.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}
