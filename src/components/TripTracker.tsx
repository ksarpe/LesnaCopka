import { useEffect } from 'react';

import { useServices } from '@/services';
import { addDistance } from '@/store/game';
import { useTripStore } from '@/store/useTripStore';

/** Śledzenie dystansu w tle, dopóki trwa wyprawa (LocationService.watchDistance). */
export function TripTracker() {
  const { location } = useServices();
  const activeId = useTripStore((s) => s.activeTripId);
  useEffect(() => {
    if (!activeId) return;
    return location.watchDistance((km) => addDistance(km));
  }, [activeId, location]);
  return null;
}
