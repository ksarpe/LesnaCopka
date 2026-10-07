import { useEffect } from 'react';

import { useServices } from '@/services';
import { addDistance } from '@/store/game';
import { useSimStore } from '@/store/useSimStore';
import { useTrackStore } from '@/store/useTrackStore';
import { useTripStore } from '@/store/useTripStore';

/**
 * Śledzenie wyprawy, dopóki trwa (LocationService.watchDistance): dystans do store'a gry,
 * przyjęte punkty do śladu w pamięci (useTrackStore – trasa w Podsumowaniu, bez zapisu na dysk).
 * Zmiana źródła pozycji (GPS ↔ symulacja) zaczyna śledzenie od nowa.
 */
export function TripTracker() {
  const { location } = useServices();
  const activeId = useTripStore((s) => s.activeTripId);
  const source = useSimStore((s) => s.locationSource);
  useEffect(() => {
    if (!activeId) return;
    const track = useTrackStore.getState();
    track.begin(activeId, source);
    const pts = useTrackStore.getState().points;
    const last = pts[pts.length - 1];
    return location.watchDistance(
      (km, point) => {
        if (km > 0) addDistance(km);
        if (point) useTrackStore.getState().add(activeId, [point]);
      },
      { resumeFrom: last ? { lat: last.lat, lon: last.lon } : undefined },
    );
  }, [activeId, location, source]);
  return null;
}
