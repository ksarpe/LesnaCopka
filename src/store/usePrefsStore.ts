import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage, STORAGE_KEYS } from './storage';

export interface PrefsState {
  /** Prywatność: zakończona wyprawa ma domyślnie ukrytą trasę (publikujemy tylko gminę). */
  hideRouteByDefault: boolean;

  set: (patch: Partial<Omit<PrefsState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const INITIAL = {
  hideRouteByDefault: false,
};

/** Ustawienia gracza z ekranu Ustawienia (persist). Nie dotyczą stanu gry ani symulacji. */
export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      ...INITIAL,
      set: (patch) => set(patch),
      reset: () => set({ ...INITIAL }),
    }),
    {
      name: STORAGE_KEYS.prefs,
      storage: persistStorage,
      version: 1,
      partialize: ({ hideRouteByDefault }) => ({ hideRouteByDefault }),
    },
  ),
);
