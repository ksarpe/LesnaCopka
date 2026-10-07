import { create } from 'zustand';

/**
 * Rankingi i statystyki gmin do pobrania od nowa (bez persist – źródłem prawdy jest serwis). Panel /dev po
 * wygenerowaniu aktywności albo przeliczeniu rankingów podbija wersję, a ekrany Gminy i szczegóły gminy
 * pobierają dane ponownie (po cichu – stare dane zostają do czasu odpowiedzi).
 */
interface StatsSyncState {
  version: number;
  invalidate: () => void;
}

export const useStatsSync = create<StatsSyncState>()((set) => ({
  version: 0,
  invalidate: () => set((s) => ({ version: s.version + 1 })),
}));
