import { create } from 'zustand';

import type { TrackPoint } from '@/geo/track';

/** Limit punktów w pamięci – ok. 13 h marszu przy odczycie co 4 s; powyżej ślad jest przerzedzany. */
const MAX_POINTS = 12_000;

type TrackSource = 'device' | 'sim';

interface TrackState {
  /** Wyprawa, do której należy ślad. */
  tripId: string | null;
  source: TrackSource | null;
  /** Przyjęte punkty (po filtrze GPS) – surowy ślad, nigdy nie pokazywany ani publikowany wprost. */
  points: TrackPoint[];
  /** Start śledzenia: nowa wyprawa albo zmiana źródła pozycji (GPS ↔ symulacja) → czysty ślad. */
  begin: (tripId: string, source: TrackSource) => void;
  add: (tripId: string, points: TrackPoint[]) => void;
  clear: () => void;
}

/** Co drugi punkt (początki odcinków i ostatni punkt zostają). */
function thin(points: TrackPoint[]): TrackPoint[] {
  return points.filter((p, i) => i % 2 === 0 || p.newSegment || i === points.length - 1);
}

/**
 * Ślad bieżącej wyprawy – WYŁĄCZNIE w pamięci (bez persist): współrzędne nie trafiają do
 * AsyncStorage ani na serwer. Po restarcie aplikacji ślad znika, a Podsumowanie pokazuje placeholder.
 */
export const useTrackStore = create<TrackState>()((set, get) => ({
  tripId: null,
  source: null,
  points: [],
  begin: (tripId, source) => {
    const s = get();
    if (s.tripId === tripId && s.source === source) return;
    set({ tripId, source, points: [] });
  },
  add: (tripId, pts) => {
    if (!pts.length || get().tripId !== tripId) return;
    const next = [...get().points, ...pts];
    set({ points: next.length > MAX_POINTS ? thin(next) : next });
  },
  clear: () => set({ tripId: null, source: null, points: [] }),
}));

const EMPTY: TrackPoint[] = [];

/** Ślad wyprawy `tripId` (pusty, jeśli w pamięci jest inna wyprawa albo aplikacja była zamknięta). */
export const useTripTrack = (tripId: string | undefined) =>
  useTrackStore((s) => (tripId && s.tripId === tripId ? s.points : EMPTY));
