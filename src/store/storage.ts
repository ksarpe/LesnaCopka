import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/** Wspólny storage dla zustand persist (AsyncStorage; na webie – localStorage). */
export const persistStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  user: 'grzyb.user.v1',
  trips: 'grzyb.trips.v1',
  sim: 'grzyb.sim.v1',
  mockDb: 'grzyb.mockdb.v1',
} as const;
