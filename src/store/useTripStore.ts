import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Find, Trip } from '@/types';
import { persistStorage, STORAGE_KEYS } from './storage';

export interface TripState {
  activeTripId: string | null;
  trips: Record<string, Trip>;
  finds: Record<string, Find>;
  patch: (p: Partial<Pick<TripState, 'activeTripId' | 'trips' | 'finds'>>) => void;
  upsertTrip: (t: Trip) => void;
  upsertFind: (f: Find) => void;
  removeFind: (id: string) => void;
  reset: () => void;
}

export const useTripStore = create<TripState>()(
  persist(
    (set) => ({
      activeTripId: null,
      trips: {},
      finds: {},
      patch: (p) => set(p),
      upsertTrip: (t) => set((s) => ({ trips: { ...s.trips, [t.id]: t } })),
      upsertFind: (f) => set((s) => ({ finds: { ...s.finds, [f.id]: f } })),
      removeFind: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.finds;
          return { finds: rest };
        }),
      reset: () => set({ activeTripId: null, trips: {}, finds: {} }),
    }),
    { name: STORAGE_KEYS.trips, storage: persistStorage, version: 1 },
  ),
);

/** Czas wyprawy z uwzględnieniem przyspieszenia (×1 / ×10). */
export function tripElapsedMs(trip: Trip, speed: number, now = Date.now()) {
  if (trip.status !== 'active') return trip.elapsedMs;
  return trip.elapsedMs + Math.max(0, now - trip.segmentStartedAt) * speed;
}

export const useActiveTrip = () => useTripStore((s) => (s.activeTripId ? s.trips[s.activeTripId] : null));
