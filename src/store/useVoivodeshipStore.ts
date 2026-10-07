import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage, STORAGE_KEYS } from './storage';

interface VoivodeshipState {
  /** Województwo wybrane na ekranie Gminy; null = automatycznie (tam, gdzie jesteś). */
  picked: string | null;
  pick: (v: string | null) => void;
}

/** Wybór województwa na ekranie Gminy (zapamiętany między uruchomieniami). Hook z domyślnym: useVoivodeship. */
export const useVoivodeshipStore = create<VoivodeshipState>()(
  persist(
    (set) => ({
      picked: null,
      pick: (picked) => set({ picked }),
    }),
    { name: STORAGE_KEYS.voivodeship, storage: persistStorage, version: 1 },
  ),
);
