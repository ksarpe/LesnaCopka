/**
 * Panel /dev: „Symuluj spacer” – dopisuje do śladu aktywnej wyprawy spacer o zadanej długości
 * (punkty co 15 m, łagodne skręty wokół bieżącej pozycji) i dolicza dystans. Pozwala sprawdzić
 * trasę w Podsumowaniu bez chodzenia po lesie. Ślad – jak zawsze – tylko w pamięci.
 */
import { gminaIndex } from '@/geo';
import { simulateWalk, type LatLon } from '@/geo/track';
import { useRegionStore } from '@/hooks/useRegion';
import { addDistance } from '@/store/game';
import { useSimStore } from '@/store/useSimStore';
import { useTrackStore } from '@/store/useTrackStore';
import { useTripStore } from '@/store/useTripStore';

/** Kierunek (rad, 0 = północ) z odcinka a → b. */
function bearing(a: LatLon, b: LatLon) {
  return Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat);
}

/** false = brak aktywnej wyprawy albo punktu startu. */
export async function devSimulateWalk(km: number): Promise<boolean> {
  const tripId = useTripStore.getState().activeTripId;
  if (!tripId) return false;
  const trip = useTripStore.getState().trips[tripId];
  useTrackStore.getState().begin(tripId, useSimStore.getState().locationSource);
  const pts = useTrackStore.getState().points;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];

  // Środek „okolicy”: wykryta pozycja, ostatni punkt śladu albo wnętrze gminy wyprawy.
  const region = useRegionStore.getState().region;
  let origin: LatLon | null = region ? { lat: region.position.lat, lon: region.position.lon } : (last ?? null);
  if (!origin && trip) {
    const meta = (await gminaIndex().catch(() => null))?.byId.get(trip.gminaId);
    if (meta) origin = { lon: meta.inner[0], lat: meta.inner[1] };
  }
  if (!origin) return false;

  const start = last ?? origin;
  const heading = last && prev ? bearing(prev, last) : Math.random() * Math.PI * 2;
  const t0 = Math.max(Date.now(), last?.t ?? 0);
  const { points } = simulateWalk({ lat: start.lat, lon: start.lon, heading }, origin, km, { rnd: Math.random, t0 });
  if (!last) points.unshift({ lat: start.lat, lon: start.lon, accuracyM: 8, t: t0, newSegment: true });
  useTrackStore.getState().add(tripId, points);
  addDistance(km);
  return true;
}
