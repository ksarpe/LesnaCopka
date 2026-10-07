import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/** Wspólny storage dla zustand persist (AsyncStorage; na webie – localStorage). */
export const persistStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  user: 'grzyb.user.v1',
  trips: 'grzyb.trips.v1',
  sim: 'grzyb.sim.v1',
  mockDb: 'grzyb.mockdb.v1',
  notifications: 'grzyb.notifications.v1',
  prefs: 'grzyb.prefs.v1',
  voivodeship: 'grzyb.voivodeship.v1',
  /** Kolejka zdarzeń gry do serwera (tylko tryb Supabase). */
  outbox: 'grzyb.outbox.v1',
  /** Obszary map offline (metadane; kafle – src/services/live/tileStore.ts). Nie czyści ich „Wyczyść dane”. */
  offlineMaps: 'grzyb.offlinemaps.v1',
} as const;
