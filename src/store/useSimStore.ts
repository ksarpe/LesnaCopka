import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEV_TOOLS } from '@/config';
import type { PermissionKind, PermissionStatus } from '@/services/types';
import { NO_SCAN_OVERRIDE, type ScanOverride } from '@/utils/identify';
import { persistStorage, STORAGE_KEYS } from './storage';

export type { ScanOverride } from '@/utils/identify';

/** Punkt symulacji: wnętrze gminy, słaby GPS (±1,5 km) albo za granicą (Wilno). */
export type SimPoint = 'gmina' | 'coarse' | 'abroad';

export interface SimState {
  /** 'device' = prawdziwy GPS (expo-location), 'sim' = punkt w wybranej gminie. */
  locationSource: 'device' | 'sim';
  /** 'device' = prawdziwy podgląd i zdjęcie (expo-camera), 'sim' = paskowany placeholder i symulowany prompt. */
  cameraSource: 'device' | 'sim';
  simPoint: SimPoint;
  /** Tryb symulacji: wybrana gmina (null = domowa gmina użytkownika). */
  forcedGminaId: string | null;
  gpsEnabled: boolean;
  networkEnabled: boolean;
  timeSpeed: 1 | 10;
  /** Wymuszony wynik skanu (gatunek / nie grzyb / niewyraźne) zamiast rozpoznania zdjęcia – src/utils/identify.ts. */
  scan: ScanOverride;
  permissions: Record<PermissionKind, PermissionStatus>;

  set: (patch: Partial<Omit<SimState, 'set' | 'setScan' | 'setPermission' | 'reset'>>) => void;
  setScan: (patch: Partial<ScanOverride>) => void;
  setPermission: (kind: PermissionKind, status: PermissionStatus) => void;
  reset: () => void;
}

const INITIAL = {
  locationSource: 'device' as 'device' | 'sim',
  cameraSource: 'device' as 'device' | 'sim',
  simPoint: 'gmina' as SimPoint,
  forcedGminaId: null,
  gpsEnabled: true,
  networkEnabled: true,
  timeSpeed: 1 as const,
  scan: { ...NO_SCAN_OVERRIDE },
  permissions: { location: 'undetermined', camera: 'undetermined' } as Record<PermissionKind, PermissionStatus>,
};

/** Dane symulacji (bez akcji) – to, co zapisuje persist. */
export type SimData = Omit<SimState, 'set' | 'setScan' | 'setPermission' | 'reset'>;

/**
 * Build bez narzędzi dev (`DEV_TOOLS = false`): zawsze GPS i aparat urządzenia, sieć i GPS włączone, czas
 * rzeczywisty, bez wymuszonego wyniku skanu. Zapis mógł zostać z buildu deweloperskiego (ten sam bundle id),
 * a panelu `/dev`, którym dałoby się to cofnąć, w wydaniu nie ma. Zgody zostają – w trybie urządzenia
 * i tak odczytujemy je z systemu przy starcie (mockInit).
 */
export function releaseSimState<T extends SimData>(s: T): T {
  return {
    ...s,
    locationSource: 'device',
    cameraSource: 'device',
    simPoint: 'gmina',
    forcedGminaId: null,
    gpsEnabled: true,
    networkEnabled: true,
    timeSpeed: 1,
    scan: { ...NO_SCAN_OVERRIDE },
  };
}

/**
 * Zapis sprzed wersji 2 (symulowany skan 360°): wymuszenia gatunku / rzadkości / trującego, tryb „spust zawsze
 * aktywny”, licznik skanów i zatrzymanie postępu – znikają; wynik skanu wraca do prawdziwego rozpoznania.
 */
export function migrateSimState(persisted: unknown, version: number): Partial<SimData> {
  const s = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 2) {
    delete s.devMode;
    delete s.scanSeq;
    delete s.scanFreezeAt;
    s.scan = { ...NO_SCAN_OVERRIDE };
  }
  return s as Partial<SimData>;
}

export const useSimStore = create<SimState>()(
  persist(
    (set) => ({
      ...INITIAL,
      set: (patch) => set(patch),
      setScan: (patch) => set((s) => ({ scan: { ...s.scan, ...patch } })),
      setPermission: (kind, status) => set((s) => ({ permissions: { ...s.permissions, [kind]: status } })),
      reset: () => set({ ...INITIAL }),
    }),
    {
      name: STORAGE_KEYS.sim,
      storage: persistStorage,
      version: 2,
      migrate: (persisted, version) => migrateSimState(persisted, version) as SimState,
      // Domyślne scalanie (płytkie) + w wydaniu wymuszenie urządzenia – zanim ktokolwiek odczyta stan.
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<SimState> | undefined) };
        return DEV_TOOLS ? merged : releaseSimState(merged);
      },
    },
  ),
);
