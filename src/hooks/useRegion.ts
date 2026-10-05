import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { useServices } from '@/services';
import { ServiceError, type Services } from '@/services/types';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import type { Region } from '@/types';

type RegionStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RegionState {
  status: RegionStatus;
  /** Ostatnio wykryty region – zostaje widoczny podczas odświeżania (status 'loading'). */
  region: Region | null;
  error: ServiceError | null;
  set: (p: Partial<Omit<RegionState, 'set'>>) => void;
}

/** Ostatnio wykryty region (gmina + pozycja) – współdzielony przez Start i Skan. Tylko w pamięci. */
export const useRegionStore = create<RegionState>()((set) => ({
  status: 'idle',
  region: null,
  error: null,
  set: (p) => set(p),
}));

let seq = 0;

export async function detectRegion(services: Services, opts: { askPermission: boolean }) {
  const id = ++seq;
  const st = useRegionStore.getState();
  const previous = st.region;
  st.set({ status: 'loading', error: null });
  try {
    if (services.permissions.get('location') === 'undetermined' && opts.askPermission) {
      await services.permissions.request('location');
    }
    const region = await services.location.getCurrentRegion(previous);
    // Gmina spoza danych gry (dowolna w Polsce) – dopisana do katalogu, by wyprawa/feed znały jej nazwę.
    useCatalogStore.getState().upsertGmina(region.gmina);
    if (id === seq) st.set({ status: 'ready', region, error: null });
    return region;
  } catch (e) {
    const err = e instanceof ServiceError ? e : new ServiceError('GPS_OFF', String(e));
    if (id === seq) st.set({ status: 'error', error: err, region: null });
    return null;
  }
}

/**
 * Region z LocationService; ponawia wykrycie, gdy zmienią się symulacje GPS / gminy / uprawnień
 * oraz po powrocie aplikacji na pierwszy plan (bez ciągłego śledzenia – oszczędność baterii).
 */
export function useRegion() {
  const services = useServices();
  const state = useRegionStore();
  const gps = useSimStore((s) => s.gpsEnabled);
  const forced = useSimStore((s) => s.forcedGminaId);
  const perm = useSimStore((s) => s.permissions.location);
  const source = useSimStore((s) => s.locationSource);
  const point = useSimStore((s) => s.simPoint);

  useEffect(() => {
    detectRegion(services, { askPermission: true });
  }, [services, gps, forced, perm, source, point]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && useRegionStore.getState().status !== 'loading') {
        detectRegion(services, { askPermission: false });
      }
    });
    return () => sub.remove();
  }, [services]);

  const retry = useCallback(() => detectRegion(services, { askPermission: true }), [services]);
  return { ...state, retry };
}
