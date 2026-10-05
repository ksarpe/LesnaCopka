import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { PermissionKind, PermissionStatus } from '@/services/types';
import type { Rarity } from '@/types';
import { persistStorage, STORAGE_KEYS } from './storage';

/** Wymuszony wynik skanu z panelu /dev (null = losowanie z seeda). */
export interface ScanOverride {
  speciesId: string | null;
  rarity: Rarity | null;
  xxl: boolean | null;
  poisonous: boolean;
  lowConfidence: boolean;
}

/** Punkt symulacji: wnętrze gminy, słaby GPS (±1,5 km) albo za granicą (Wilno). */
export type SimPoint = 'gmina' | 'coarse' | 'abroad';

export interface SimState {
  /** 'device' = prawdziwy GPS (expo-location), 'sim' = punkt w wybranej gminie. */
  locationSource: 'device' | 'sim';
  simPoint: SimPoint;
  /** Tryb symulacji: wybrana gmina (null = domowa gmina użytkownika). */
  forcedGminaId: string | null;
  gpsEnabled: boolean;
  networkEnabled: boolean;
  timeSpeed: 1 | 10;
  /** Tryb dev: spust skanu aktywny zawsze. */
  devMode: boolean;
  scan: ScanOverride;
  permissions: Record<PermissionKind, PermissionStatus>;
  /** Licznik skanów – kolejne wyniki mocka są deterministyczne. */
  scanSeq: number;
  /** Dev-link: zatrzymaj postęp skanu na danej wartości (0..1) – do zrzutów. */
  scanFreezeAt: number | null;

  set: (patch: Partial<Omit<SimState, 'set' | 'setScan' | 'setPermission' | 'reset'>>) => void;
  setScan: (patch: Partial<ScanOverride>) => void;
  setPermission: (kind: PermissionKind, status: PermissionStatus) => void;
  reset: () => void;
}

const INITIAL = {
  locationSource: 'device' as 'device' | 'sim',
  simPoint: 'gmina' as SimPoint,
  forcedGminaId: null,
  gpsEnabled: true,
  networkEnabled: true,
  timeSpeed: 1 as const,
  devMode: false,
  scan: { speciesId: null, rarity: null, xxl: null, poisonous: false, lowConfidence: false },
  permissions: { location: 'undetermined', camera: 'undetermined' } as Record<PermissionKind, PermissionStatus>,
  scanSeq: 0,
  scanFreezeAt: null as number | null,
};

export const useSimStore = create<SimState>()(
  persist(
    (set) => ({
      ...INITIAL,
      set: (patch) => set(patch),
      setScan: (patch) => set((s) => ({ scan: { ...s.scan, ...patch } })),
      setPermission: (kind, status) => set((s) => ({ permissions: { ...s.permissions, [kind]: status } })),
      reset: () => set({ ...INITIAL }),
    }),
    { name: STORAGE_KEYS.sim, storage: persistStorage, version: 1 },
  ),
);
